/* Pitchify — goal mapping & session engine
   ExerciseDB has no speed/stamina/strength/agility/flexibility taxonomy,
   so each goal maps to a small set of API queries (max 2 per goal),
   merged, ranked and de-duplicated client-side. Documented in README. */
const Goals = (() => {
  'use strict';

  const EQUIPMENT = [
    { id: 'bodyweight', label: 'Bodyweight only', hint: 'No equipment needed', filter: 'bodyweight' },
    { id: 'freeweights', label: 'Free weights', hint: 'Barbell · dumbbell · kettlebell', filter: 'barbell,dumbbell,kettlebell' },
    { id: 'fullgym', label: 'Full gym', hint: 'Machines, cables & free weights', filter: '' },
  ];

  const LEVELS = [
    { id: 'beginner', label: 'Beginner', hint: 'New to training' },
    { id: 'intermediate', label: 'Intermediate', hint: 'Regular training' },
    { id: 'advanced', label: 'Advanced', hint: 'Competitive / high volume' },
  ];

  const GOALS = [
    {
      id: 'speed',
      name: 'Speed',
      tagline: 'First-step quickness & acceleration',
      blurb: 'Explosive leg power and sprint mechanics for beating your marker to the ball.',
      accent: 'lime',
      icon: 'bolt',
      queries: [
        { targetMuscles: 'quadriceps,hamstrings,glutes,calves' },
        { name: 'sprint' },
      ],
      boost: /(sprint|jump|bounds?|plyometric|lunge|hop|drive|acceler)/i,
      coach: {
        beginner:    { sets: '3 sets', reps: '6–8 per side', rest: 75 },
        intermediate:{ sets: '4 sets', reps: '8–10 per side', rest: 90 },
        advanced:    { sets: '5 sets', reps: '8–12 per side', rest: 90 },
      },
      note: 'Rest fully between explosive sets — quality over quantity. 2–3 sessions a week.',
    },
    {
      id: 'stamina',
      name: 'Stamina',
      tagline: 'Engine for the full 90 minutes',
      blurb: 'Aerobic conditioning so you are still pressing in the 85th minute.',
      accent: 'green',
      icon: 'pulse',
      queries: [
        { bodyParts: 'cardio' },
      ],
      boost: /(burpee|mountain|jumping|squat|walk|run|high knees|jumping jack)/i,
      coach: {
        beginner:    { sets: '3 rounds', reps: '40s on / 20s off', rest: 45 },
        intermediate:{ sets: '4 rounds', reps: '45s on / 15s off', rest: 30 },
        advanced:    { sets: '5 rounds', reps: '60s on / 15s off', rest: 30 },
      },
      note: 'Keep heart rate in a steady working zone — you should be able to speak short sentences only.',
    },
    {
      id: 'strength',
      name: 'Strength',
      tagline: 'Win duels, hold ground, stay injury-free',
      blurb: 'Lower-body and trunk strength for shielding, jumping and contact balance.',
      accent: 'sand',
      icon: 'dumbbell',
      queries: [
        { bodyParts: 'upper legs,chest,back,shoulders' },
      ],
      boost: /(squat|deadlift|press|row|lunge|hip|bench|pull|carry)/i,
      coach: {
        beginner:    { sets: '3 sets', reps: '8–10 reps', rest: 90 },
        intermediate:{ sets: '4 sets', reps: '6–10 reps', rest: 105 },
        advanced:    { sets: '5 sets', reps: '4–8 reps', rest: 120 },
      },
      note: 'Control every rep. Add load only when the last set feels clean.',
    },
    {
      id: 'agility',
      name: 'Agility',
      tagline: 'Change direction before they react',
      blurb: 'Footwork, balance and core control for cutting, turning and recovering shape.',
      accent: 'mint',
      icon: 'arrows',
      queries: [
        { bodyParts: 'cardio,waist' },
        { targetMuscles: 'abdominals,hip flexors,obliques' },
      ],
      boost: /(crawl|plank|balance|ladder|side|lateral|step|twist|rotat|burpee|jump)/i,
      coach: {
        beginner:    { sets: '3 sets', reps: '30–40s', rest: 45 },
        intermediate:{ sets: '4 sets', reps: '40–45s', rest: 40 },
        advanced:    { sets: '5 sets', reps: '45–60s', rest: 35 },
      },
      note: 'Speed comes from technique — slow it down until the feet stop stumbling.',
    },
    {
      id: 'flexibility',
      name: 'Flexibility',
      tagline: 'Range, recovery, longer career',
      blurb: 'Mobility work for hips, hamstrings and the posterior chain footballers neglect.',
      accent: 'violet',
      icon: 'stretch',
      queries: [
        { name: 'stretch' },
        { targetMuscles: 'hamstrings,quadriceps,glutes' },
      ],
      boost: /(stretch|mobility|hip|hamstring|calf|groin|open|flow)/i,
      coach: {
        beginner:    { sets: '2 sets', reps: '30s holds', rest: 20 },
        intermediate:{ sets: '3 sets', reps: '30–45s holds', rest: 20 },
        advanced:    { sets: '3 sets', reps: '45–60s holds', rest: 25 },
      },
      note: 'Never bounce into pain. Breathe out as you sink deeper — daily is best.',
    },
  ];

  const MIN_POOL = 6;
  const SESSION_SIZE = 6;

  function getGoal(id) { return GOALS.find(g => g.id === id) || null; }
  function getEquipment(id) { return EQUIPMENT.find(e => e.id === id) || null; }
  function getLevel(id) { return LEVELS.find(l => l.id === id) || null; }

  function score(item, goal, equipment, priority) {
    const name = String(item.name || '');
    let s = 100 - priority * 10;
    if (goal.boost && goal.boost.test(name)) s += 40;
    if (equipment && equipment.filter) {
      const eq = (item.equipments || []).join(' ').toLowerCase();
      if (equipment.filter.split(',').some(f => eq.indexOf(f) !== -1)) s += 15;
    }
    // small bonus for football-relevant body parts on power goals
    const bp = (item.bodyParts || []).join(' ').toLowerCase();
    if ((goal.id === 'speed' || goal.id === 'agility') && /legs|waist|cardio/.test(bp)) s += 10;
    if (goal.id === 'flexibility' && /legs|back|waist/.test(bp)) s += 10;
    return s;
  }

  /** Fetch, merge, rank and de-duplicate a goal's query plan.
   *  Relaxes the equipment filter if the pool is too small. */
  async function buildPlan(goalId, equipmentId) {
    const goal = getGoal(goalId);
    if (!goal) throw new Error('Unknown goal: ' + goalId);
    const equipment = getEquipment(equipmentId) || null;

    async function run(withEquipment) {
      const out = [];
      for (let i = 0; i < goal.queries.length; i++) {
        const q = Object.assign({}, goal.queries[i]);
        if (withEquipment && equipment && equipment.filter) q.equipments = equipment.filter;
        try {
          const page = await PitchAPI.fetchPage(q);
          out.push(...page.items);
        } catch (err) {
          if (i === 0) throw err;         // first query is essential
          // secondary query failing is non-fatal (e.g. 404 on name filter)
        }
      }
      return PitchAPI.dedupe(out);
    }

    let pool = await run(true);
    if (pool.length < MIN_POOL && equipment && equipment.filter) {
      pool = await run(false);            // relax: drop equipment filter
    }
    pool.sort((a, b) => score(b, goal, equipment, 0) - score(a, goal, equipment, 0));
    // re-score is uniform per query index; simply stable-sort by boost:
    pool.sort((a, b) => {
      const ga = goal.boost && goal.boost.test(a.name || '') ? 1 : 0;
      const gb = goal.boost && goal.boost.test(b.name || '') ? 1 : 0;
      return gb - ga;
    });
    return pool;
  }

  /* ---------- deterministic daily session ---------- */
  function hashSeed(str) {
    let h = 1779033703 ^ str.length;
    for (let i = 0; i < str.length; i++) {
      h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    return (h >>> 0);
  }
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** Pick SESSION_SIZE exercises, spreading body parts. Seeded → stable per day. */
  function pickSession(pool, seedStr, size) {
    const n = size || SESSION_SIZE;
    if (!pool || pool.length === 0) return [];
    const rnd = mulberry32(hashSeed(seedStr));
    const shuffled = pool.slice().sort(() => rnd() - 0.5);

    // spread across body parts, round-robin
    const buckets = new Map();
    for (const it of shuffled) {
      const key = (it.bodyParts && it.bodyParts[0]) || 'misc';
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(it);
    }
    const queues = Array.from(buckets.values());
    const out = [];
    while (out.length < n) {
      let added = false;
      for (const q of queues) {
        if (out.length >= n) break;
        if (q.length) { out.push(q.shift()); added = true; }
      }
      if (!added) break;
    }
    return out;
  }

  function guidance(goalId, levelId) {
    const goal = getGoal(goalId);
    const level = getLevel(levelId) || { id: 'beginner' };
    if (!goal) return { sets: '3 sets', reps: '8–10 reps', rest: 60 };
    return goal.coach[level.id] || goal.coach.beginner;
  }

  return {
    EQUIPMENT, LEVELS, GOALS, SESSION_SIZE,
    getGoal, getEquipment, getLevel,
    buildPlan, pickSession, guidance, hashSeed,
  };
})();
