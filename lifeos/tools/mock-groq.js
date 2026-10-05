// Test-only fake of Groq's chat endpoint:  node tools/mock-groq.js [port]
// Replies are chosen from the system prompt so the app's AI features can be exercised without a real key.
import { createServer } from 'node:http';
const port = Number(process.argv[2]) || 8130;
const out = (obj) => ({ choices: [{ message: { content: JSON.stringify(obj) } }] });
createServer((req, res) => {
  let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => {
    const j = b ? JSON.parse(b) : {}; const sys = (j.messages || []).map((m) => m.content).join('\n');
    let r;
    if (/You design a personal tracker/.test(sys) && /reduce my weight to 80/i.test((j.messages || []).filter((m) => m.role === 'user').map((m) => m.content).join(' '))) r = out({ name: 'Weight', icon: 'target', color: 'blue', description: 'Reduce weight to 80 kg', keywords: ['weight', 'weigh'], fields: [{ label: 'Weight', type: 'number', unit: 'kg', min: 0, max: 0, options: [], agg: 'last', targetValue: 80, targetPeriod: 'goal', targetDir: 'atmost', quick: [], startValue: 0, targetWeeks: 8 }], reminders: [], rules: [], note: 'A goal to reach 80 kg, measured from your first reading.' });
    else if (/practical, warm coach/.test(sys)) r = out({ summary: 'You are steadily moving toward your goal.', suggestions: [{ title: 'Weigh in each morning', detail: 'Same time each day gives a cleaner trend.' }, { title: 'Add a 20-minute walk', detail: 'Three times this week.' }], watchOuts: ['Day-to-day swings are normal.'], questions: ['How is your evening eating going?'] });
    else if (/You design a personal tracker/.test(sys)) r = out({ name: 'Running', icon: 'walk', color: 'green', description: 'Training for a half marathon', keywords: ['run', 'ran', 'running', 'jog'],
      fields: [{ label: 'Distance', type: 'number', unit: 'km', min: 0, max: 0, options: [], agg: 'sum', targetValue: 30, targetPeriod: 'week', targetDir: 'atleast', quick: [5, 10] }, { label: 'Effort', type: 'scale', unit: '', min: 0, max: 10, options: [], agg: 'avg', targetValue: 0, targetPeriod: 'day', targetDir: 'atleast', quick: [] }],
      reminders: [], rules: [{ name: 'Rest after four runs', kind: 'streak', fieldLabel: '', op: '', value: 0, windowDays: 7, count: 4, byTime: '', message: 'Four run days in a row — take a rest day.' }], note: 'Distance adds up each day toward a weekly goal, and effort is averaged.' });
    else if (/Turn the user's sentence into ONE rule/.test(sys)) { const m = sys.match(/"id":"(trk_[^"]+|[a-z]+_[a-z0-9]+)"/); const idm = sys.match(/"trackers":\[\{"id":"([^"]+)"/); const fm = sys.match(/"fields":\[\{"id":"([^"]+)"/);
      r = out({ name: 'Heavy coffee', trackerId: idm?.[1] || '', kind: 'threshold', field: fm?.[1] || '', op: '>=', value: 4, windowDays: 7, count: 2, byTime: '', message: 'That is a lot of caffeine today ({value}).', problem: '' }); }
    else if (/decide which of THEIR trackers/.test(sys)) { const idm = sys.match(/"trackers":\[\{"id":"([^"]+)"/); const fm = sys.match(/"fields":\[\{"id":"([^"]+)"/); r = out({ entries: [{ trackerId: idm?.[1] || '', valuesJson: JSON.stringify({ [fm?.[1] || 'x']: 7 }), confidence: 0.9, clarification: '' }] }); }
    else if (/user asked a question about how two things/.test(sys)) { const refs = [...sys.matchAll(/"ref":"([^"]+)"/g)].map((m) => m[1]); r = out({ x: refs[0] || '', y: refs[1] || '', lagDays: 1, explanation: 'Comparing the first two things you track, next day.' }); }
    else r = out({ decision: 'observe', message: 'Mock advisor reply.', evidence: [], confidence: 0.7, uncertainty: '', primaryAction: '', secondaryOptions: [], proposedActions: [] });
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(r));
  });
}).listen(port, () => console.log(`mock groq on ${port}`));
