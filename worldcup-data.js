const WC_DATA = (() => {
  const venues = [
    { id: "mexico-city", name: "Mexico City Stadium", city: "Mexico City", country: "Mexico", tz: "America/Mexico_City" },
    { id: "guadalajara", name: "Guadalajara Stadium", city: "Guadalajara", country: "Mexico", tz: "America/Mexico_City" },
    { id: "monterrey", name: "Monterrey Stadium", city: "Monterrey", country: "Mexico", tz: "America/Monterrey" },
    { id: "toronto", name: "Toronto Stadium", city: "Toronto", country: "Canada", tz: "America/Toronto" },
    { id: "vancouver", name: "Vancouver Stadium", city: "Vancouver", country: "Canada", tz: "America/Vancouver" },
    { id: "la", name: "Los Angeles Stadium", city: "Los Angeles", country: "United States", tz: "America/Los_Angeles" },
    { id: "sf", name: "San Francisco Bay Area Stadium", city: "San Francisco Bay Area", country: "United States", tz: "America/Los_Angeles" },
    { id: "seattle", name: "Seattle Stadium", city: "Seattle", country: "United States", tz: "America/Los_Angeles" },
    { id: "dallas", name: "Dallas Stadium", city: "Dallas", country: "United States", tz: "America/Chicago" },
    { id: "houston", name: "Houston Stadium", city: "Houston", country: "United States", tz: "America/Chicago" },
    { id: "kansas-city", name: "Kansas City Stadium", city: "Kansas City", country: "United States", tz: "America/Chicago" },
    { id: "atlanta", name: "Atlanta Stadium", city: "Atlanta", country: "United States", tz: "America/New_York" },
    { id: "miami", name: "Miami Stadium", city: "Miami", country: "United States", tz: "America/New_York" },
    { id: "boston", name: "Boston Stadium", city: "Boston", country: "United States", tz: "America/New_York" },
    { id: "philadelphia", name: "Philadelphia Stadium", city: "Philadelphia", country: "United States", tz: "America/New_York" },
    { id: "new-jersey", name: "New York New Jersey Stadium", city: "New Jersey", country: "United States", tz: "America/New_York" }
  ];

  const groups = [
    {
      id: "A",
      accent: "#23784b",
      teams: [
        team("MEX", "Mexico", "Mexico", "🇲🇽"),
        team("RSA", "South Africa", "South Africa", "🇿🇦"),
        team("KOR", "South Korea", "South Korea", "🇰🇷"),
        team("CZE", "Czechia", "Czechia", "🇨🇿")
      ]
    },
    {
      id: "B",
      accent: "#c83f38",
      teams: [
        team("CAN", "Canada", "Canada", "🇨🇦"),
        team("BIH", "Bosnia and Herzegovina", "Bosnia and Herzegovina", "🇧🇦"),
        team("QAT", "Qatar", "Qatar", "🇶🇦"),
        team("SUI", "Switzerland", "Switzerland", "🇨🇭")
      ]
    },
    {
      id: "C",
      accent: "#c8bf31",
      teams: [
        team("BRA", "Brazil", "Brazil", "🇧🇷"),
        team("MAR", "Morocco", "Morocco", "🇲🇦"),
        team("HAI", "Haiti", "Haiti", "🇭🇹"),
        team("SCO", "Scotland", "Scotland", "🏴")
      ]
    },
    {
      id: "D",
      accent: "#2f6498",
      teams: [
        team("USA", "United States", "United States", "🇺🇸"),
        team("PAR", "Paraguay", "Paraguay", "🇵🇾"),
        team("AUS", "Australia", "Australia", "🇦🇺"),
        team("TUR", "Türkiye", "Türkiye", "🇹🇷")
      ]
    },
    {
      id: "E",
      accent: "#dc7432",
      teams: [
        team("GER", "Germany", "Germany", "🇩🇪"),
        team("CUW", "Curaçao", "Curaçao", "🇨🇼"),
        team("CIV", "Côte d'Ivoire", "Côte d'Ivoire", "🇨🇮"),
        team("ECU", "Ecuador", "Ecuador", "🇪🇨")
      ]
    },
    {
      id: "F",
      accent: "#2b7f61",
      teams: [
        team("NED", "Netherlands", "Netherlands", "🇳🇱"),
        team("JPN", "Japan", "Japan", "🇯🇵"),
        team("SWE", "Sweden", "Sweden", "🇸🇪"),
        team("TUN", "Tunisia", "Tunisia", "🇹🇳")
      ]
    },
    {
      id: "G",
      accent: "#6b6396",
      teams: [
        team("BEL", "Belgium", "Belgium", "🇧🇪"),
        team("EGY", "Egypt", "Egypt", "🇪🇬"),
        team("IRN", "Iran", "Iran", "🇮🇷"),
        team("NZL", "New Zealand", "New Zealand", "🇳🇿")
      ]
    },
    {
      id: "H",
      accent: "#159a8b",
      teams: [
        team("ESP", "Spain", "Spain", "🇪🇸"),
        team("CPV", "Cape Verde", "Cape Verde", "🇨🇻"),
        team("KSA", "Saudi Arabia", "Saudi Arabia", "🇸🇦"),
        team("URU", "Uruguay", "Uruguay", "🇺🇾")
      ]
    },
    {
      id: "I",
      accent: "#334d8f",
      teams: [
        team("FRA", "France", "France", "🇫🇷"),
        team("SEN", "Senegal", "Senegal", "🇸🇳"),
        team("IRQ", "Iraq", "Iraq", "🇮🇶"),
        team("NOR", "Norway", "Norway", "🇳🇴")
      ]
    },
    {
      id: "J",
      accent: "#e06b62",
      teams: [
        team("ARG", "Argentina", "Argentina", "🇦🇷"),
        team("ALG", "Algeria", "Algeria", "🇩🇿"),
        team("AUT", "Austria", "Austria", "🇦🇹"),
        team("JOR", "Jordan", "Jordan", "🇯🇴")
      ]
    },
    {
      id: "K",
      accent: "#d24275",
      teams: [
        team("POR", "Portugal", "Portugal", "🇵🇹"),
        team("COD", "DR Congo", "DR Congo", "🇨🇩"),
        team("UZB", "Uzbekistan", "Uzbekistan", "🇺🇿"),
        team("COL", "Colombia", "Colombia", "🇨🇴")
      ]
    },
    {
      id: "L",
      accent: "#9f3435",
      teams: [
        team("ENG", "England", "England", "🏴"),
        team("CRO", "Croatia", "Croatia", "🇭🇷"),
        team("GHA", "Ghana", "Ghana", "🇬🇭"),
        team("PAN", "Panama", "Panama", "🇵🇦")
      ]
    }
  ];

  const groupFixtures = buildGroupFixtures(groups, venues);
  const knockoutFixtures = buildKnockoutFixtures(venues);
  const allFixtures = [...groupFixtures, ...knockoutFixtures];

  return { groups, venues, groupFixtures, knockoutFixtures, allFixtures };

  function team(id, name, country, flag, played = 0, points = 0, gd = 0) {
    return {
      id,
      name,
      shortName: id,
      country,
      flag,
      played,
      wins: points === 3 ? 1 : 0,
      draws: 0,
      losses: played && points === 0 ? 1 : 0,
      goalsFor: gd > 0 ? gd : 0,
      goalsAgainst: gd < 0 ? Math.abs(gd) : 0,
      goalDifference: gd,
      points
    };
  }

  function buildGroupFixtures() {
    const schedule = [
      groupMatch("A", "MEX", "RSA", "2026-06-11", "3:00 PM", "mexico-city"),
      groupMatch("A", "KOR", "CZE", "2026-06-11", "10:00 PM", "guadalajara"),
      groupMatch("B", "CAN", "BIH", "2026-06-12", "3:00 PM", "toronto"),
      groupMatch("D", "USA", "PAR", "2026-06-12", "9:00 PM", "la"),
      groupMatch("B", "QAT", "SUI", "2026-06-13", "3:00 PM", "sf"),
      groupMatch("C", "BRA", "MAR", "2026-06-13", "6:00 PM", "new-jersey"),
      groupMatch("C", "HAI", "SCO", "2026-06-13", "9:00 PM", "boston"),
      groupMatch("D", "AUS", "TUR", "2026-06-13", "12:00 AM", "vancouver"),
      groupMatch("E", "GER", "CUW", "2026-06-14", "1:00 PM", "houston"),
      groupMatch("F", "NED", "JPN", "2026-06-14", "4:00 PM", "dallas"),
      groupMatch("E", "CIV", "ECU", "2026-06-14", "7:00 PM", "philadelphia"),
      groupMatch("F", "TUN", "SWE", "2026-06-14", "10:00 PM", "monterrey"),
      groupMatch("H", "ESP", "CPV", "2026-06-15", "12:00 PM", "atlanta"),
      groupMatch("G", "BEL", "EGY", "2026-06-15", "3:00 PM", "seattle"),
      groupMatch("H", "KSA", "URU", "2026-06-15", "6:00 PM", "miami"),
      groupMatch("G", "IRN", "NZL", "2026-06-15", "9:00 PM", "la"),
      groupMatch("I", "FRA", "SEN", "2026-06-16", "3:00 PM", "new-jersey"),
      groupMatch("I", "IRQ", "NOR", "2026-06-16", "6:00 PM", "boston"),
      groupMatch("J", "ARG", "ALG", "2026-06-16", "9:00 PM", "kansas-city"),
      groupMatch("J", "AUT", "JOR", "2026-06-16", "12:00 AM", "sf"),
      groupMatch("K", "POR", "COD", "2026-06-17", "1:00 PM", "houston"),
      groupMatch("L", "ENG", "CRO", "2026-06-17", "4:00 PM", "dallas"),
      groupMatch("L", "GHA", "PAN", "2026-06-17", "7:00 PM", "toronto"),
      groupMatch("K", "UZB", "COL", "2026-06-17", "10:00 PM", "mexico-city"),
      groupMatch("A", "CZE", "RSA", "2026-06-18", "12:00 PM", "atlanta"),
      groupMatch("B", "SUI", "BIH", "2026-06-18", "3:00 PM", "la"),
      groupMatch("B", "CAN", "QAT", "2026-06-18", "6:00 PM", "vancouver"),
      groupMatch("A", "MEX", "KOR", "2026-06-18", "9:00 PM", "guadalajara"),
      groupMatch("D", "USA", "AUS", "2026-06-19", "3:00 PM", "seattle"),
      groupMatch("C", "SCO", "MAR", "2026-06-19", "3:00 PM", "boston"),
      groupMatch("C", "BRA", "HAI", "2026-06-19", "9:00 PM", "philadelphia"),
      groupMatch("D", "TUR", "PAR", "2026-06-19", "12:00 AM", "sf"),
      groupMatch("F", "NED", "SWE", "2026-06-20", "1:00 PM", "houston"),
      groupMatch("E", "GER", "CIV", "2026-06-20", "4:00 PM", "toronto"),
      groupMatch("E", "ECU", "CUW", "2026-06-20", "8:00 PM", "kansas-city"),
      groupMatch("F", "TUN", "JPN", "2026-06-20", "12:00 AM", "monterrey"),
      groupMatch("H", "ESP", "KSA", "2026-06-21", "12:00 PM", "atlanta"),
      groupMatch("G", "BEL", "IRN", "2026-06-21", "3:00 PM", "la"),
      groupMatch("H", "URU", "CPV", "2026-06-21", "6:00 PM", "miami"),
      groupMatch("G", "NZL", "EGY", "2026-06-21", "9:00 PM", "vancouver"),
      groupMatch("J", "ARG", "AUT", "2026-06-22", "1:00 PM", "dallas"),
      groupMatch("I", "FRA", "IRQ", "2026-06-22", "5:00 PM", "philadelphia"),
      groupMatch("I", "NOR", "SEN", "2026-06-22", "8:00 PM", "new-jersey"),
      groupMatch("J", "JOR", "ALG", "2026-06-22", "11:00 PM", "sf"),
      groupMatch("K", "POR", "UZB", "2026-06-23", "1:00 PM", "houston"),
      groupMatch("L", "ENG", "GHA", "2026-06-23", "4:00 PM", "boston"),
      groupMatch("L", "PAN", "CRO", "2026-06-23", "7:00 PM", "toronto"),
      groupMatch("K", "COL", "COD", "2026-06-23", "10:00 PM", "guadalajara"),
      groupMatch("B", "SUI", "CAN", "2026-06-24", "3:00 PM", "vancouver"),
      groupMatch("B", "BIH", "QAT", "2026-06-24", "3:00 PM", "seattle"),
      groupMatch("C", "BRA", "SCO", "2026-06-24", "6:00 PM", "miami"),
      groupMatch("C", "MAR", "HAI", "2026-06-24", "6:00 PM", "atlanta"),
      groupMatch("A", "MEX", "CZE", "2026-06-24", "9:00 PM", "mexico-city"),
      groupMatch("A", "KOR", "RSA", "2026-06-24", "9:00 PM", "monterrey"),
      groupMatch("E", "ECU", "GER", "2026-06-25", "4:00 PM", "new-jersey"),
      groupMatch("E", "CUW", "CIV", "2026-06-25", "4:00 PM", "philadelphia"),
      groupMatch("F", "TUN", "NED", "2026-06-25", "7:00 PM", "kansas-city"),
      groupMatch("F", "JPN", "SWE", "2026-06-25", "7:00 PM", "dallas"),
      groupMatch("D", "USA", "TUR", "2026-06-25", "10:00 PM", "la"),
      groupMatch("D", "PAR", "AUS", "2026-06-25", "10:00 PM", "sf"),
      groupMatch("I", "NOR", "FRA", "2026-06-26", "3:00 PM", "boston"),
      groupMatch("I", "SEN", "IRQ", "2026-06-26", "3:00 PM", "toronto"),
      groupMatch("H", "URU", "ESP", "2026-06-26", "8:00 PM", "guadalajara"),
      groupMatch("H", "CPV", "KSA", "2026-06-26", "8:00 PM", "houston"),
      groupMatch("G", "NZL", "BEL", "2026-06-26", "11:00 PM", "vancouver"),
      groupMatch("G", "EGY", "IRN", "2026-06-26", "11:00 PM", "seattle"),
      groupMatch("L", "PAN", "ENG", "2026-06-27", "5:00 PM", "new-jersey"),
      groupMatch("L", "CRO", "GHA", "2026-06-27", "5:00 PM", "philadelphia"),
      groupMatch("K", "COL", "POR", "2026-06-27", "7:30 PM", "miami"),
      groupMatch("K", "COD", "UZB", "2026-06-27", "7:30 PM", "atlanta"),
      groupMatch("J", "ARG", "JOR", "2026-06-27", "10:00 PM", "dallas"),
      groupMatch("J", "ALG", "AUT", "2026-06-27", "10:00 PM", "kansas-city")
    ];
    const matchCounts = new Map();

    return schedule.map((item, index) => {
      const groupCount = (matchCounts.get(item.group) || 0) + 1;
      matchCounts.set(item.group, groupCount);

      return {
        id: `G${item.group}-${groupCount}`,
        stage: "Group",
        group: item.group,
        matchday: Math.floor((groupCount - 1) / 2) + 1,
        home: item.home,
        away: item.away,
        homeScore: null,
        awayScore: null,
        status: "scheduled",
        minute: null,
        kickoff: item.kickoff,
        venue: item.venue,
        order: index + 1
      };
    });
  }

  function buildKnockoutFixtures() {
    return [
      knockout("K01", "Round of 32", "2A", "2B", "2026-06-28", "3:00 PM", "la"),
      knockout("K02", "Round of 32", "1C", "2F", "2026-06-29", "1:00 PM", "houston"),
      knockout("K03", "Round of 32", "1E", "3A/B/C/D/F", "2026-06-29", "4:30 PM", "boston"),
      knockout("K04", "Round of 32", "1F", "2C", "2026-06-29", "9:00 PM", "monterrey"),
      knockout("K05", "Round of 32", "2E", "2I", "2026-06-30", "1:00 PM", "dallas"),
      knockout("K06", "Round of 32", "1I", "3C/D/F/G/H", "2026-06-30", "5:00 PM", "new-jersey"),
      knockout("K07", "Round of 32", "1A", "3C/E/F/H/I", "2026-06-30", "9:00 PM", "mexico-city"),
      knockout("K08", "Round of 32", "1L", "3E/H/I/J/K", "2026-07-01", "12:00 PM", "atlanta"),
      knockout("K09", "Round of 32", "1G", "3A/E/H/I/J", "2026-07-01", "4:00 PM", "seattle"),
      knockout("K10", "Round of 32", "1D", "3B/E/F/I/J", "2026-07-01", "8:00 PM", "sf"),
      knockout("K11", "Round of 32", "1H", "2J", "2026-07-02", "3:00 PM", "la"),
      knockout("K12", "Round of 32", "2K", "2L", "2026-07-02", "7:00 PM", "toronto"),
      knockout("K13", "Round of 32", "1B", "3D/E/I/J/L", "2026-07-02", "11:00 PM", "vancouver"),
      knockout("K14", "Round of 32", "2D", "2G", "2026-07-03", "2:00 PM", "dallas"),
      knockout("K15", "Round of 32", "1J", "2H", "2026-07-03", "6:00 PM", "miami"),
      knockout("K16", "Round of 32", "1K", "3D/E/I/J/L", "2026-07-03", "9:30 PM", "kansas-city"),
      knockout("K17", "Round of 16", "W01", "W02", "2026-07-04", "1:00 PM", "houston"),
      knockout("K18", "Round of 16", "W03", "W04", "2026-07-04", "5:00 PM", "philadelphia"),
      knockout("K19", "Round of 16", "W05", "W06", "2026-07-05", "4:00 PM", "new-jersey"),
      knockout("K20", "Round of 16", "W07", "W08", "2026-07-05", "8:00 PM", "mexico-city"),
      knockout("K21", "Round of 16", "W09", "W10", "2026-07-06", "3:00 PM", "dallas"),
      knockout("K22", "Round of 16", "W11", "W12", "2026-07-06", "8:00 PM", "seattle"),
      knockout("K23", "Round of 16", "W13", "W14", "2026-07-07", "12:00 PM", "atlanta"),
      knockout("K24", "Round of 16", "W15", "W16", "2026-07-07", "4:00 PM", "vancouver"),
      knockout("K25", "Quarter-final", "W17", "W18", "2026-07-09", "4:00 PM", "boston"),
      knockout("K26", "Quarter-final", "W19", "W20", "2026-07-10", "3:00 PM", "la"),
      knockout("K27", "Quarter-final", "W21", "W22", "2026-07-11", "5:00 PM", "miami"),
      knockout("K28", "Quarter-final", "W23", "W24", "2026-07-11", "9:00 PM", "kansas-city"),
      knockout("K29", "Semi-final", "W25", "W26", "2026-07-14", "3:00 PM", "dallas"),
      knockout("K30", "Semi-final", "W27", "W28", "2026-07-15", "3:00 PM", "atlanta"),
      knockout("K31", "Third-place play-off", "L29", "L30", "2026-07-18", "5:00 PM", "miami"),
      knockout("K32", "Final", "W29", "W30", "2026-07-19", "3:00 PM", "new-jersey")
    ];
  }

  function groupMatch(group, home, away, date, timeEt, venue) {
    return {
      group,
      home,
      away,
      venue,
      kickoff: easternKickoff(date, timeEt)
    };
  }

  function knockout(id, stage, home, away, date, timeEt, venue) {
    return {
      id,
      stage,
      home,
      away,
      homeScore: null,
      awayScore: null,
      status: "scheduled",
      minute: null,
      kickoff: easternKickoff(date, timeEt),
      venue
    };
  }

  function easternKickoff(date, timeEt) {
    const [year, month, day] = date.split("-").map(Number);
    const match = timeEt.match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)$/i);
    if (!match) throw new Error(`Invalid ET kickoff time: ${timeEt}`);

    let hour = Number(match[1]);
    const minute = Number(match[2] || 0);
    const meridiem = match[3].toUpperCase();
    const isLateMidnightSlot = meridiem === "AM" && hour === 12;

    if (meridiem === "AM") hour = hour === 12 ? 0 : hour;
    if (meridiem === "PM" && hour !== 12) hour += 12;

    return new Date(Date.UTC(year, month - 1, day + (isLateMidnightSlot ? 1 : 0), hour + 4, minute, 0)).toISOString();
  }
})();

if (typeof module !== "undefined") {
  module.exports = WC_DATA;
}
