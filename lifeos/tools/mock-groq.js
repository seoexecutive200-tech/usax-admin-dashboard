// Test-only fake of Groq's chat endpoint:  node tools/mock-groq.js [port]
// Replies are chosen from the system prompt so the app's AI features can be exercised without a real key.
import { createServer } from 'node:http';
const port = Number(process.argv[2]) || 8130;
const out = (obj) => ({ choices: [{ message: { content: JSON.stringify(obj) } }] });
let flaky = 'none'; let calls = [];
createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/__flaky') { flaky = u.searchParams.get('m') || 'none'; calls = []; res.end('ok'); return; }
  if (u.pathname === '/__calls') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(calls)); return; }
  let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => {
    const j = b ? JSON.parse(b) : {};
    calls.push({ model: j.model, fmt: j.response_format?.type || '' });
    const bad = (failed) => { res.statusCode = 400; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ error: { message: "Failed to validate JSON. Please adjust your prompt. See 'failed_generation' for more details.", type: 'invalid_request_error', code: 'json_validate_failed', failed_generation: failed } })); };
    if (flaky === 'strict' && j.response_format?.type === 'json_schema') return bad('{"oops":');
    if (flaky === 'salvage' && j.response_format?.type === 'json_schema') return bad('{"message":"salvaged reply"}');
    if (flaky === 'model' && j.model === 'openai/gpt-oss-20b') return bad('not json');
    if (flaky === 'all') return bad('nope'); const sys = (j.messages || []).map((m) => m.content).join('\n');
    let r;
    if (/You design a personal tracker/.test(sys) && /reduce my weight to 80/i.test((j.messages || []).filter((m) => m.role === 'user').map((m) => m.content).join(' '))) r = out({ name: 'Weight', icon: 'target', color: 'blue', description: 'Reduce weight to 80 kg', keywords: ['weight', 'weigh'], fields: [{ label: 'Weight', type: 'number', unit: 'kg', min: 0, max: 0, options: [], agg: 'last', targetValue: 80, targetPeriod: 'goal', targetDir: 'atmost', quick: [], startValue: 0, targetWeeks: 8 }], reminders: [], rules: [], note: 'A goal to reach 80 kg, measured from your first reading.' });
    else if (/opening line of a short check-in/.test(sys)) { let u = {}; try { u = JSON.parse((j.messages || []).filter((m) => m.role === 'user').pop().content); } catch { /* ignore */ } r = out({ message: `${u.line || 'Heads up.'} Let’s make it a good one.` }); }
    else if (/Plan the rest of the user's day/.test(sys)) { let u = {}; try { u = JSON.parse((j.messages || []).filter((m) => m.role === 'user').pop().content); } catch { /* ignore */ }
      const w = (u.freeWindows || [])[0] || '09:00–10:00'; const st = w.split('–')[0]; const [hh, mm] = st.split(':').map(Number); const add = (m) => { const t = hh * 60 + mm + m; return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`; };
      const t0 = (u.tasks || [])[0]; r = out({ summary: 'Hardest task first while your energy is good, then a break.', blocks: [{ title: t0?.title || 'Focus', start: st, durationMin: 45, kind: 'focus', taskId: t0?.id || '' }, { title: 'Break', start: add(45), durationMin: 10, kind: 'break', taskId: '' }, { title: 'Impossible', start: '03:00', durationMin: 30, kind: 'focus', taskId: '' }] }); }
    else if (/thoughtful assistant would/.test(sys)) { const u = (j.messages || []).filter((m) => m.role === 'user').map((m) => m.content).join(' '); const round2 = /"round":2/.test(u); r = out(round2 ? { understood: 'Lose weight to 80 kg, steadily.', kind: 'goal', ready: true, questions: [] } : { understood: 'You want to lose weight and reach 80 kg.', kind: /meeting|dentist/i.test(u) ? 'event' : /note/i.test(u) ? 'note' : 'goal', ready: false, questions: [{ id: 'a', question: 'What is your weight right now?', why: 'To measure progress from your start', options: [] }, { id: 'b', question: 'How quickly would you like to get there?', why: 'Sets a realistic pace', options: ['4 weeks', '8 weeks', '12 weeks', 'No deadline'] }, { id: 'c', question: 'How often will you weigh in?', why: 'Decides reminders', options: ['Daily', 'Weekly'] }] }); }
    else if (/Turn the user's text and their answers into one task, event or note/.test(sys)) r = out({ title: 'Dentist check-up', start: new Date(Date.now() + 86400000).toISOString(), durationMin: 45, notes: 'Bring insurance card' });
    else if (/turn a person's description of their daily routines/i.test(sys)) r = out({ routines: [
      { name: 'Office', days: [1, 2, 3, 4, 5, 6], start: '10:00', end: '18:00', assume: false, water: true, waterEvery: 90, breaks: true, breakEvery: 90, lunch: true, lunchAt: '13:30', eyes: false, wrap: true, reminders: [{ time: '15:30', text: 'Stand and stretch' }] },
      { name: 'Gym', days: [1, 3, 5], start: '07:00', end: '08:00', assume: false, water: false, waterEvery: 60, breaks: false, breakEvery: 90, lunch: false, lunchAt: '', eyes: false, wrap: false, reminders: [] },
      { name: 'Wind-down', days: [1, 2, 3, 4, 5], start: '22:00', end: '23:30', assume: false, water: false, waterEvery: 60, breaks: false, breakEvery: 90, lunch: false, lunchAt: '', eyes: false, wrap: false, reminders: [{ time: '23:00', text: 'Put the phone away' }, { time: '06:00', text: 'outside window - dropped' }] }], note: 'I read “10 to 6” as 10am–6pm.' });
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
