// Shared, dependency-free projection logic used by both the browser client and
// the Node test suite. It derives, from the current standings:
//   * projectBracket(data)     - which team fills each knockout slot
//   * computeQualification(data) - each team's group-stage qualification status
//   * rankThirdPlaceTeams(...)  - the best-third ranking (shared with the table)
//
// Everything is computed from data already present in a snapshot (groups with
// standings, group fixtures, knockout fixtures), so it works identically
// whether the data came from the live provider or the local fallback model.

(function (root) {
  "use strict";

  // The same comparator the third-place table uses, kept here so the bracket and
  // the table never disagree about who the eight best thirds are.
  function rankThirdPlaceTeams(groups) {
    return (groups || [])
      .map((group) => ({ group: group.id, ...group.teams[2] }))
      .sort((a, b) =>
        b.points - a.points ||
        b.goalDifference - a.goalDifference ||
        b.goalsFor - a.goalsFor ||
        a.group.localeCompare(b.group)
      );
  }

  function isGroupComplete(group, groupFixtures) {
    const fixtures = (groupFixtures || []).filter((fixture) => fixture.group === group.id);
    return fixtures.length > 0 && fixtures.every((fixture) => fixture.status === "finished");
  }

  function allGroupsComplete(groups, groupFixtures) {
    return (groups || []).length > 0 && groups.every((group) => isGroupComplete(group, groupFixtures));
  }

  // ---------------------------------------------------------------------------
  // Qualification status
  //
  // Uses provably-safe bounds (a team can only gain points, never lose them) so
  // it never tells a fan they are through or out unless it is mathematically
  // certain. Reasoning is within-group, matching how this app orders its tables.
  // ---------------------------------------------------------------------------
  function computeQualification(data) {
    const groups = data.groups || [];
    const groupFixtures = data.groupFixtures || [];
    const thirdsComplete = allGroupsComplete(groups, groupFixtures);
    const qualifyingThirdGroups = new Set(
      rankThirdPlaceTeams(groups).slice(0, 8).map((team) => team.group)
    );
    const statuses = {};

    for (const group of groups) {
      const complete = isGroupComplete(group, groupFixtures);
      group.teams.forEach((team, index) => {
        statuses[team.id] = decorate(statusKeyFor(team, group, index, complete, thirdsComplete, qualifyingThirdGroups));
      });
    }
    return statuses;
  }

  function statusKeyFor(team, group, index, complete, thirdsComplete, qualifyingThirdGroups) {
    if (complete) {
      if (index < 2) return "through";
      if (index === 2) {
        if (!thirdsComplete) return "third-watch";
        return qualifyingThirdGroups.has(group.id) ? "through" : "out";
      }
      return "out";
    }
    return liveStatusKey(team, group.teams);
  }

  function liveStatusKey(team, teams) {
    const others = teams.filter((candidate) => candidate.id !== team.id);
    const remaining = (entry) => Math.max(0, 3 - entry.played);
    const maxPoints = (entry) => entry.points + 3 * remaining(entry);
    const myCeiling = team.points + 3 * remaining(team);

    // Teams whose current points already exceed my best possible total: they are
    // certain to finish above me.
    const certainlyAbove = others.filter((entry) => entry.points > myCeiling).length;
    // Teams that can still reach or pass my current points: potential overtakers.
    const canReachMe = others.filter((entry) => maxPoints(entry) >= team.points).length;

    if (certainlyAbove >= 3) return "out";          // guaranteed last place
    if (certainlyAbove === 2) return "third-watch"; // can't make top two, can still be third
    if (canReachMe <= 1) return "through";          // at most one team can finish above me
    return "contention";
  }

  function decorate(key) {
    switch (key) {
      case "through": return { key, label: "Through", glyph: "✓", tone: "through" };
      case "out": return { key, label: "Eliminated", glyph: "✗", tone: "out" };
      case "third-watch": return { key, label: "3rd-place watch", glyph: "3", tone: "watch" };
      default: return { key: "contention", label: "In contention", glyph: "", tone: "contention" };
    }
  }

  // ---------------------------------------------------------------------------
  // Bracket projection
  // ---------------------------------------------------------------------------
  function projectBracket(data) {
    const groups = data.groups || [];
    const groupFixtures = data.groupFixtures || [];
    const knockoutFixtures = data.knockoutFixtures || [];

    const teamIds = new Set(groups.flatMap((group) => group.teams.map((team) => team.id)));
    const groupComplete = {};
    for (const group of groups) groupComplete[group.id] = isGroupComplete(group, groupFixtures);
    const thirdsComplete = allGroupsComplete(groups, groupFixtures);

    // Winner/runner-up of each group from the current (sorted) standings.
    const positionTeam = {};
    const positionProjected = {};
    for (const group of groups) {
      ["1", "2"].forEach((rank, offset) => {
        const team = group.teams[offset];
        if (!team) return;
        positionTeam[rank + group.id] = team.id;
        positionProjected[rank + group.id] = !groupComplete[group.id];
      });
    }

    // Best-third slots are keyed by fixture+side, not by their group string,
    // because two knockout fixtures can carry the same eligible-group list yet
    // must still receive two different third-placed teams.
    const thirdOccurrences = [];
    for (const fixture of knockoutFixtures) {
      for (const side of ["home", "away"]) {
        if (isThirdSlot(fixture[side])) {
          thirdOccurrences.push({ fixtureId: fixture.id, side, groups: eligibleGroups(fixture[side]) });
        }
      }
    }
    const thirdByKey = assignBestThirds(thirdOccurrences, rankThirdPlaceTeams(groups));

    const matchOutcome = {};
    const resolved = {};
    // Knockout fixtures are stored in round order (K01..K32) and every W##/L##
    // reference points at an earlier-numbered match, so a single forward pass
    // resolves the whole tree.
    for (const fixture of knockoutFixtures) {
      const home = resolveSide(fixture, "home");
      const away = resolveSide(fixture, "away");
      resolved[fixture.id] = { home, away };
      const number = matchNumber(fixture.id);
      if (number != null) matchOutcome[number] = outcomeFor(fixture, home, away);
    }

    return { resolved, positionTeam, positionProjected, matchOutcome, thirdsComplete };

    function resolveSide(fixture, side) {
      const slot = fixture[side];

      const winner = /^1([A-L])$/.exec(slot);
      if (winner) return slotInfo(slot, positionTeam["1" + winner[1]], positionProjected["1" + winner[1]]);

      const runner = /^2([A-L])$/.exec(slot);
      if (runner) return slotInfo(slot, positionTeam["2" + runner[1]], positionProjected["2" + runner[1]]);

      if (isThirdSlot(slot)) {
        const assignment = thirdByKey[fixture.id + "|" + side];
        return slotInfo(slot, assignment ? assignment.teamId : null, !thirdsComplete);
      }

      const matchWinner = /^W(\d+)$/.exec(slot);
      if (matchWinner) {
        const outcome = matchOutcome[Number(matchWinner[1])];
        return slotInfo(slot, outcome && outcome.winner, outcome ? outcome.projected : true);
      }

      const matchLoser = /^L(\d+)$/.exec(slot);
      if (matchLoser) {
        const outcome = matchOutcome[Number(matchLoser[1])];
        return slotInfo(slot, outcome && outcome.loser, outcome ? outcome.projected : true);
      }

      // The provider has already named this knockout slot's real team (a live
      // result merged onto the fixture), so treat it as confirmed.
      if (teamIds.has(slot)) return slotInfo(slot, slot, false);

      return slotInfo(slot, null, true);
    }
  }

  function slotInfo(slot, teamId, projected) {
    return { slot, teamId: teamId || null, projected: teamId ? Boolean(projected) : false };
  }

  function outcomeFor(fixture, home, away) {
    const homeScore = fixture.homeScore;
    const awayScore = fixture.awayScore;
    const decided =
      fixture.status === "finished" &&
      Number.isInteger(homeScore) &&
      Number.isInteger(awayScore) &&
      homeScore !== awayScore; // a level finished knockout went to penalties we cannot read

    if (decided) {
      const homeWon = homeScore > awayScore;
      return {
        winner: (homeWon ? home.teamId : away.teamId) || null,
        loser: (homeWon ? away.teamId : home.teamId) || null,
        projected: false
      };
    }
    return { winner: null, loser: null, projected: true };
  }

  // Match a finished/sorted set of eight best thirds onto the eight knockout
  // slots, honouring each slot's eligible-group list. Returns a map keyed by
  // "fixtureId|side". Degrades to an all-null map if no perfect matching exists.
  function assignBestThirds(occurrences, ranking) {
    const result = {};
    for (const occurrence of occurrences) result[occurrence.fixtureId + "|" + occurrence.side] = null;

    const qualifiers = ranking.slice(0, 8);
    if (occurrences.length === 0 || qualifiers.length < occurrences.length) return result;

    const byGroup = new Map(qualifiers.map((qualifier) => [qualifier.group, qualifier]));
    // Solve the most constrained slots first to keep the search shallow.
    const order = occurrences.slice().sort((a, b) => a.groups.length - b.groups.length);
    const usedGroups = new Set();
    const assignment = {};

    const search = (index) => {
      if (index === order.length) return true;
      const occurrence = order[index];
      for (const group of occurrence.groups) {
        const qualifier = byGroup.get(group);
        if (!qualifier || usedGroups.has(group)) continue;
        usedGroups.add(group);
        assignment[occurrence.fixtureId + "|" + occurrence.side] = qualifier;
        if (search(index + 1)) return true;
        usedGroups.delete(group);
        delete assignment[occurrence.fixtureId + "|" + occurrence.side];
      }
      return false;
    };

    if (!search(0)) return result;

    for (const occurrence of occurrences) {
      const qualifier = assignment[occurrence.fixtureId + "|" + occurrence.side];
      if (qualifier) {
        result[occurrence.fixtureId + "|" + occurrence.side] = { group: qualifier.group, teamId: qualifier.id };
      }
    }
    return result;
  }

  function isThirdSlot(slot) {
    return /^3[A-L](?:\/[A-L])+$/.test(String(slot || ""));
  }

  function eligibleGroups(slot) {
    return String(slot).slice(1).split("/");
  }

  function matchNumber(id) {
    const match = /^K(\d+)$/.exec(String(id || ""));
    return match ? Number(match[1]) : null;
  }

  const api = {
    rankThirdPlaceTeams,
    isGroupComplete,
    allGroupsComplete,
    computeQualification,
    projectBracket
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    root.WCProjection = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
