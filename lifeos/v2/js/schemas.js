// JSON Schemas for structured model output + a tiny local validator.
// Schemas follow Groq strict-mode rules: every property required, additionalProperties:false.
const str = { type: 'string' };
const num = { type: 'number' };
const strArr = { type: 'array', items: str };
const numArr = { type: 'array', items: num };
const FIELD_TYPE_ENUM = ['number', 'scale', 'duration', 'rating', 'yesno', 'choice', 'text'];
const AGG_ENUM = ['sum', 'avg', 'last', 'count', 'max', 'min'];
const ICON_ENUM = ['target', 'droplet', 'moon', 'heart', 'bolt', 'dumbbell', 'walk', 'coffee', 'utensils', 'note', 'brain', 'smile', 'sun', 'wallet', 'clock', 'flag', 'users', 'calendar', 'mountain', 'sparkle'];
const COLOR_ENUM = ['blue', 'violet', 'green', 'amber', 'coral', 'pink', 'teal'];
const obj = (properties) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });

export const ACTION_TYPES = [
  'create_log', 'update_log', 'delete_log', 'create_event', 'update_event', 'delete_event',
  'create_task', 'update_task', 'reschedule_task', 'create_goal', 'update_goal',
  'add_memory', 'update_memory', 'forget_memory', 'create_advisor_item', 'dismiss_advisor_item',
  'create_experiment', 'finish_experiment', 'generate_daily_report', 'generate_weekly_report',
  'create_entry', 'update_entry', 'delete_entry',
];

const evidence = { type: 'array', items: obj({ kind: { type: 'string', enum: ['observed', 'calculated', 'inference', 'unknown'] }, text: str }) };
const proposedActions = { type: 'array', items: obj({ type: { type: 'string', enum: ACTION_TYPES }, payloadJson: str, reason: str }) };

export const SCHEMAS = {
  tracker: obj({
    name: str, icon: { type: 'string', enum: ICON_ENUM }, color: { type: 'string', enum: COLOR_ENUM }, description: str, keywords: strArr,
    fields: { type: 'array', items: obj({ label: str, type: { type: 'string', enum: FIELD_TYPE_ENUM }, unit: str, min: num, max: num, options: strArr, agg: { type: 'string', enum: AGG_ENUM }, targetValue: num, targetPeriod: { type: 'string', enum: ['day', 'week', 'goal'] }, startValue: num, targetWeeks: num, targetDir: { type: 'string', enum: ['atleast', 'atmost'] }, quick: numArr }) },
    reminders: { type: 'array', items: obj({ time: str, days: numArr, text: str }) },
    rules: { type: 'array', items: obj({ name: str, kind: { type: 'string', enum: ['threshold', 'count', 'streak', 'missing'] }, fieldLabel: str, op: { type: 'string', enum: ['>', '>=', '<', '<=', '=', ''] }, value: num, windowDays: num, count: num, byTime: str, message: str }) },
    note: str,
  }),
  rule: obj({ name: str, trackerId: str, kind: { type: 'string', enum: ['threshold', 'count', 'streak', 'missing'] }, field: str, op: { type: 'string', enum: ['>', '>=', '<', '<=', '=', ''] }, value: num, windowDays: num, count: num, byTime: str, message: str, problem: str }),
  route: obj({ entries: { type: 'array', items: obj({ trackerId: str, valuesJson: str, confidence: num, clarification: str }) } }),
  routines: obj({ routines: { type: 'array', items: obj({ name: str, days: numArr, start: str, end: str, assume: { type: 'boolean' }, water: { type: 'boolean' }, waterEvery: num, breaks: { type: 'boolean' }, breakEvery: num, lunch: { type: 'boolean' }, lunchAt: str, eyes: { type: 'boolean' }, wrap: { type: 'boolean' }, reminders: { type: 'array', items: obj({ time: str, text: str }) } }) }, note: str }),
  clarify: obj({ understood: str, kind: { type: 'string', enum: ['tracker', 'goal', 'note', 'task', 'event', 'routine', 'unsure'] }, ready: { type: 'boolean' }, questions: { type: 'array', items: obj({ id: str, question: str, why: str, options: strArr }) } }),
  refined: obj({ title: str, start: str, durationMin: num, notes: str }),
  coach: obj({ summary: str, suggestions: { type: 'array', items: obj({ title: str, detail: str }) }, watchOuts: strArr, questions: strArr }),
  series: obj({ x: str, y: str, lagDays: num, explanation: str }),
  advisor: obj({
    decision: { type: 'string', enum: ['silent', 'observe', 'suggest', 'ask_quick_question', 'urgent_escalation'] },
    message: str, evidence, confidence: num, uncertainty: str,
    primaryAction: str, secondaryOptions: strArr, proposedActions,
  }),
  capture: obj({
    candidates: { type: 'array', items: obj({
      type: { type: 'string', enum: ['log', 'event', 'task', 'goal', 'memory', 'finance_entry', 'note'] },
      summary: str, fieldsJson: str, confidence: num, needsConfirmation: { type: 'boolean' }, clarification: str,
    }) },
  }),
  memory: obj({
    candidates: { type: 'array', items: obj({
      kind: { type: 'string', enum: ['explicit_preference', 'explicit_fact', 'goal', 'temporary_context', 'observed_pattern'] },
      text: str, confidence: num, evidenceCount: num, expiresInDays: num, reason: str,
    }) },
  }),
  readiness: obj({
    readinessSummary: str, preparationState: str, energyOutlook: str, scheduleSpace: str, mentalLoad: str,
    confidence: num, primaryRecommendation: str, prepTasks: strArr, showCheckIn: { type: 'boolean' },
  }),
  daily: obj({
    narrative: str, wentWell: strArr, pressure: strArr, deviation: str, pattern: str, tomorrowFocus: str, confidence: num,
  }),
  weekly: obj({
    narrative: str, trajectory: str, biggestImprovement: str, biggestPressure: str,
    relationships: strArr, futureLoad: str, nextWeekFocus: str, confidence: num,
  }),
  experiment: obj({
    hypothesis: str, intervention: str, durationDays: num, measures: strArr, minAdherence: str,
    confounders: strArr, stopConditions: strArr, interpretation: str, metric: { type: 'string', enum: ['sleep', 'mood', 'energy', 'stress', 'focus', 'water', 'workout'] },
  }),
  health: obj({ class: { type: 'string', enum: ['lifestyle_context_only', 'nonurgent_professional_followup_reasonable', 'urgent_real_world_evaluation_recommended', 'emergency_action_recommended'] }, reason: str }),
  feedback: obj({ updates: { type: 'array', items: obj({ text: str, kind: { type: 'string', enum: ['advisor_preference', 'intervention_effect'] }, evidenceDelta: num }) } }),
};

export function validate(value, schema, path = '$') {
  const errors = [];
  const t = schema.type;
  const typeOk = t === 'array' ? Array.isArray(value) : t === 'object' ? value && typeof value === 'object' && !Array.isArray(value)
    : t === 'number' ? typeof value === 'number' && Number.isFinite(value) : typeof value === t;
  if (!typeOk) return [`${path}: expected ${t}`];
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${path}: not in enum`);
  if (t === 'object') {
    for (const k of schema.required || []) if (!(k in value)) errors.push(`${path}.${k}: missing`);
    for (const [k, s] of Object.entries(schema.properties || {})) if (k in value) errors.push(...validate(value[k], s, `${path}.${k}`));
  }
  if (t === 'array') value.forEach((v, i) => errors.push(...validate(v, schema.items, `${path}[${i}]`)));
  return errors;
}

// Fill omitted fields so non-strict models still produce renderable objects.
export function withDefaults(value, schema) {
  if (schema.type === 'object' && value && typeof value === 'object') {
    const out = { ...value };
    for (const [k, s] of Object.entries(schema.properties)) {
      if (!(k in out)) out[k] = s.type === 'array' ? [] : s.type === 'string' ? '' : s.type === 'number' ? 0 : s.type === 'boolean' ? false : null;
      else if (s.type === 'object' || s.type === 'array') out[k] = withDefaults(out[k], s);
    }
    return out;
  }
  if (schema.type === 'array' && Array.isArray(value)) return value.map((v) => withDefaults(v, schema.items));
  return value;
}
