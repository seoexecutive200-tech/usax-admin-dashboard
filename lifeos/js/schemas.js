// JSON Schemas for structured model output + a tiny local validator.
// Schemas follow Groq strict-mode rules: every property required, additionalProperties:false.
const str = { type: 'string' };
const num = { type: 'number' };
const strArr = { type: 'array', items: str };
const obj = (properties) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });

export const ACTION_TYPES = [
  'create_log', 'update_log', 'delete_log', 'create_event', 'update_event', 'delete_event',
  'create_task', 'update_task', 'reschedule_task', 'create_goal', 'update_goal',
  'add_memory', 'update_memory', 'forget_memory', 'create_advisor_item', 'dismiss_advisor_item',
  'create_experiment', 'finish_experiment', 'generate_daily_report', 'generate_weekly_report',
];

const evidence = { type: 'array', items: obj({ kind: { type: 'string', enum: ['observed', 'calculated', 'inference', 'unknown'] }, text: str }) };
const proposedActions = { type: 'array', items: obj({ type: { type: 'string', enum: ACTION_TYPES }, payloadJson: str, reason: str }) };

export const SCHEMAS = {
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
