// The 100 check-in definitions from the "Adaptive Check-In & Data Intelligence Specification". They are a LIBRARY, not a schedule:
// the engine (checkins.js) picks at most one that fits the moment — or none. Every definition is addressable by id.
// Field types: scale · choice · multi · time · number · text. Every field is optional — leaving it empty stores "unknown" (null), never a guess.
const sc = (k, l, min = 1, max = 10) => ({ k, t: 'scale', l, min, max });
const ch = (k, l, o) => ({ k, t: 'choice', l, o });
const mu = (k, l, o) => ({ k, t: 'multi', l, o });
const tm = (k, l) => ({ k, t: 'time', l });
const nu = (k, l, u = '') => ({ k, t: 'number', l, u });
const tx = (k, l = 'Anything to add?') => ({ k, t: 'text', l });

export const DOMAINS = {
  today: 'Morning', sleep: 'Sleep & recovery', food: 'Food', drink: 'Hydration & caffeine', move: 'Movement', work: 'Work & focus',
  plan: 'Schedule & events', mind: 'Mood & stress', money: 'Money & admin', review: 'Evening & learning',
};
// Features that are off until you switch them on (spec: optional / user-enabled only).
export const OPT_IN = {
  body: 'Body check-ins (symptoms, soreness)', digestion: 'Digestion tracking', caffeine: 'Caffeine tracking', alcohol: 'Alcohol logging',
  meds: 'Medication / supplement reminders', finance: 'Money check-ins', social: 'Social-connection goal', debrief: 'Event debriefs',
  hydration: 'Hydration target', foodlog: 'Detailed food logging', appetite: 'Appetite tracking',
};

const D = (id, domain, prompt, when, fields, extra = {}) => ({ id, domain, prompt, when, fields, ...extra });
const E5 = ['Low', 'Limited', 'Normal', 'High'];
const OCC = ['Normal', 'Travel', 'Sick', 'Family duty', 'Deadline', 'Something else'];

export const CHECKINS = [
  // A — morning orientation
  D(1, 'today', 'How are you starting today?', 'First meaningful open after you wake; skipped if you logged all three in the last 90 minutes.', [sc('energy', 'Energy'), sc('mood', 'Mood'), sc('stress', 'Stress'), tx('note', 'Note (optional)')], { fresh: 90 }),
  D(2, 'today', 'What time did you actually go to bed and get up?', 'Morning, when sleep timing is missing.', [tm('bed', 'Went to bed'), tm('wake', 'Got up'), ch('known', 'Do you know how long you actually slept?', ['Yes', 'No']), nu('sleptH', 'Hours actually slept (only if you know)', 'h')], { fresh: 600 }),
  D(3, 'today', 'What 1–3 things would make today feel successful?', 'Morning, especially when your task list is long or has no priorities.', [tx('p1', 'First'), tx('p2', 'Second (optional)'), tx('p3', 'Third (optional)')], { fresh: 600 }),
  D(4, 'today', 'Anything changed since you planned today — a new meeting, a cancellation, a deadline, an errand?', 'Morning, if your plans changed overnight or weren’t reviewed for 12 hours.', [tx('change', 'What changed?')], { fresh: 720 }),
  D(5, 'today', 'How much usable capacity do you feel you have today?', 'A dense day, poor sleep or high stress.', [ch('capacity', 'Capacity', E5), tx('why', 'Why? (optional)')], { fresh: 600 }),
  D(6, 'today', 'Do you already know when you’ll have your first proper meal today?', 'Morning, when there’s no meal plan and the day is dense.', [tm('mealAt', 'Roughly when'), ch('plan', 'Or', ['Not sure yet'])], { fresh: 600 }),
  D(7, 'today', 'Last night looked shorter than your usual. How do you actually feel this morning?', 'Only after you confirmed how long you slept, and it was clearly short of your target.', [sc('energy', 'Energy'), sc('sleepy', 'Sleepiness'), ch('feel', 'Overall', ['Okay', 'Affected'])], { fresh: 600 }),
  D(8, 'today', 'Anything physically unusual this morning that you want LifeOS to track?', 'Only if you turned on body check-ins, after a symptom, hard training or travel.', [tx('what', 'What is it?'), sc('severity', 'How strong (1–10)'), ch('course', 'Is it', ['New', 'Ongoing'])], { fresh: 600, optin: 'body', safety: 'symptom' }),
  D(9, 'today', 'You have an important event coming up. What would make you feel prepared for it today?', 'An important event is inside your preparation window.', [tx('prep', 'What would help?'), ch('none', 'Or', ['Nothing needed'])], { fresh: 600, perEvent: true }),
  D(10, 'today', 'Is today a normal day for you, or is something changing the routine?', 'Morning, when your schedule looks unusual.', [ch('ctx', 'Today is', OCC), tx('detail', 'Detail (optional)'), nu('days', 'For how many days, if you know', 'd')], { fresh: 600 }),
  // B — sleep & recovery
  D(11, 'sleep', 'What time do you want to be asleep tonight?', 'Evening, or when tomorrow has an important commitment.', [tm('target', 'Asleep by')], { fresh: 600 }),
  D(12, 'sleep', 'Did you fall asleep around the time you intended?', 'Next morning, when you had set a bedtime intention.', [ch('when', 'You fell asleep', ['Around then', 'Earlier', 'Later']), tm('approx', 'About what time (optional)')], { fresh: 600 }),
  D(13, 'sleep', 'What woke you today?', 'Occasionally — not daily.', [ch('wake', 'Woken by', ['Alarm', 'Naturally', 'Another person', 'Discomfort', 'Something else']), tx('note', 'Note (optional)')], { fresh: 14 * 1440 }),
  D(14, 'sleep', 'How restorative did last night feel?', 'Morning after a sleep log, especially when duration and energy disagree.', [sc('rest', 'Restfulness')], { fresh: 600 }),
  D(15, 'sleep', 'Were you awake for long periods during the night?', 'When sleep felt poor or you mention broken sleep.', [ch('awake', 'Awake', ['No', 'Once', 'Several times', 'Unsure']), nu('mins', 'Minutes, if you know', 'min')], { fresh: 600 }),
  D(16, 'sleep', 'Did you nap today?', 'Afternoon or evening, when it matters for your energy or sleep.', [ch('nap', 'Nap', ['No', 'Yes']), tm('start', 'Started (optional)'), nu('mins', 'Minutes (optional)', 'min')], { fresh: 600 }),
  D(17, 'sleep', 'You’re below your sleep target so far this week. Is that intentional or unwanted?', 'Weekly shortfall against your own target, using only sleep you confirmed.', [ch('why', 'It is', ['Intentional', 'Temporary', 'Unwanted', 'My target is wrong'])], { fresh: 6 * 1440 }),
  D(18, 'sleep', 'Was anything different last evening?', 'Only when your sleep changed noticeably and the cause is unknown.', [mu('f', 'Select any', ['Late work', 'Caffeine', 'Screens', 'Heavy meal', 'Stress', 'Travel', 'Alcohol']), tx('other', 'Other')], { fresh: 600 }),
  D(19, 'sleep', 'Your sleep timing has shifted this week. Is that a problem for you?', 'Your bed or wake times moved noticeably.', [ch('prob', 'Is it a problem?', ['No', 'Yes', 'Temporary', 'Planned'])], { fresh: 6 * 1440 }),
  D(20, 'sleep', 'Since changing your sleep routine, do you feel better, worse, or unchanged?', '3–7 days after you start a sleep change.', [ch('eff', 'You feel', ['Better', 'Unchanged', 'Worse']), tx('note', 'Note (optional)')], { fresh: 6 * 1440 }),
  // C — food
  D(21, 'food', 'Have you eaten since your last check-in?', 'When it’s relevant to your energy or schedule — not at every meal.', [ch('ate', 'Eaten?', ['Yes', 'No', 'About to'])], { fresh: 240 }),
  D(22, 'food', 'What time did you have that meal?', 'A meal was logged without a time.', [tm('at', 'Time')], { fresh: 240 }),
  D(23, 'food', 'What was in the meal?', 'When you choose to log meal detail.', [mu('cats', 'Pick what applies', ['Grains / starchy food', 'Vegetables', 'Fruit', 'Legumes', 'Eggs / meat / fish', 'Dairy or alternative', 'Nuts / seeds', 'Sweets / snacks', 'Other']), tx('text', 'In your words')], { fresh: 240, optin: 'foodlog' }),
  D(24, 'food', 'How hungry were you before eating?', 'Only in appetite-tracking mode.', [sc('hunger', 'Hunger (0–10)', 0, 10)], { fresh: 240, optin: 'appetite' }),
  D(25, 'food', 'How satisfied or full do you feel after that meal?', 'Optional follow-up, at most once a day.', [sc('full', 'Fullness (0–10)', 0, 10), ch('comfort', 'It feels', ['Comfortable', 'Uncomfortable'])], { fresh: 1440, optin: 'appetite' }),
  D(26, 'food', 'Did you have a snack or drink you want counted in today’s food log?', 'Only if you want detailed food tracking.', [ch('yes', 'Add one?', ['Yes', 'No']), tx('item', 'What was it?')], { fresh: 240, optin: 'foodlog' }),
  D(27, 'food', 'Looking at today’s logged food, anything missing that you still plan to eat?', 'Evening, when your food log is reasonably complete.', [ch('state', 'Log is', ['Complete', 'Incomplete', 'Plan to eat more']), tx('more', 'What?')], { fresh: 1440, optin: 'foodlog' }),
  D(28, 'food', 'Was this meal typical for you or unusual?', 'The meal differs from your pattern, or you’re travelling or celebrating.', [ch('typ', 'It was', ['Typical', 'Unusual', 'Special occasion'])], { fresh: 600 }),
  D(29, 'food', 'Any digestive discomfort after eating?', 'Only if you turned on digestion tracking.', [ch('what', 'What', ['None', 'Bloating', 'Reflux', 'Pain', 'Nausea', 'Other']), sc('severity', 'How strong (1–10)')], { fresh: 600, optin: 'digestion', safety: 'symptom' }),
  D(30, 'food', 'You have an important event around your usual meal time. Want to plan food around it?', 'An upcoming event overlaps the time you usually eat.', [ch('plan', 'Plan', ['Yes', 'No', 'Suggest options', 'I’ll handle it'])], { fresh: 600, perEvent: true }),
  // D — hydration & caffeine
  D(31, 'drink', 'Want to log some water or another drink?', 'After a workout, a meal or a long gap, or when you open the hydration card.', [nu('ml', 'Amount (ml) — leave empty if unknown', 'ml'), ch('kind', 'Drink', ['Water', 'Tea / coffee', 'Other'])], { fresh: 120 }),
  D(32, 'drink', 'You’re behind the hydration target you set. Is it still realistic today?', 'Only with a target you set yourself and a clear lag.', [ch('ok', 'Target is', ['Yes, still realistic', 'Lower today', 'Needs editing', 'My log is incomplete'])], { fresh: 600, optin: 'hydration' }),
  D(33, 'drink', 'Are you feeling thirsty right now?', 'Occasionally, if you want to track body signals.', [ch('thirst', 'Thirst', ['No', 'A little', 'Yes', 'Very'])], { fresh: 600, optin: 'body' }),
  D(34, 'drink', 'Did you have caffeine?', 'When caffeine tracking is on.', [tx('drink', 'What'), tm('at', 'When'), nu('mg', 'Caffeine (mg) — only if you know', 'mg')], { fresh: 120, optin: 'caffeine' }),
  D(35, 'drink', 'Thinking about more caffeine today?', 'Later in the day, if caffeine is tracked and you have a bedtime intention.', [ch('more', 'More?', ['Yes', 'No', 'Unsure'])], { fresh: 600, optin: 'caffeine' }),
  D(36, 'drink', 'Do you want alcohol included in today’s log?', 'Only if you enabled it.', [ch('yes', 'Include', ['No', 'Yes']), tx('what', 'What / how much, if you know')], { fresh: 600, optin: 'alcohol' }),
  D(37, 'drink', 'Did you take the medication or supplement you asked LifeOS to track?', 'Only for items you configured. LifeOS never advises on doses.', [tx('item', 'Which one'), ch('st', 'Status', ['Taken', 'Skipped', 'Later', 'Unsure'])], { fresh: 240, optin: 'meds' }),
  D(38, 'drink', 'How did that caffeine affect you?', 'Occasionally after caffeine, when you’re testing effects.', [mu('fx', 'Select any', ['Better focus', 'Jitters', 'Nothing noticeable', 'Something else']), sc('level', 'Strength (optional)')], { fresh: 600, optin: 'caffeine' }),
  D(39, 'drink', 'After that workout, do you want to log fluids?', 'Right after a workout, when hydration tracking is on.', [nu('ml', 'Amount (ml)', 'ml'), ch('kind', 'Drink', ['Water', 'Other'])], { fresh: 120, optin: 'hydration' }),
  D(40, 'drink', 'Your hydration target rarely matches what you log. Keep it, change it, or stop tracking it?', 'Weekly, when the target is repeatedly missed or exceeded.', [ch('do', 'Target', ['Keep', 'Edit', 'Pause tracking'])], { fresh: 7 * 1440, optin: 'hydration' }),
  // E — movement
  D(41, 'move', 'Do you want movement or a workout in today’s plan?', 'Morning or plan review, when nothing active is planned and exercise is a goal of yours.', [ch('do', 'Today', ['No', 'Walk', 'Workout', 'Mobility', 'Custom']), tm('at', 'Around when (optional)')], { fresh: 720 }),
  D(42, 'move', 'You’ve been in a long work block. Want a short movement break?', 'After a long focus session you started yourself — never from tracking you.', [ch('do', 'Break', ['Yes, now', 'Later', 'No'])], { fresh: 180 }),
  D(43, 'move', 'How ready do you feel for the workout you planned?', 'Before a planned, demanding workout when energy looks low.', [sc('ready', 'Readiness'), ch('pain', 'Soreness or pain?', ['No', 'Yes'])], { fresh: 240, safety: 'pain' }),
  D(44, 'move', 'What did you actually do?', 'After a scheduled workout, or when you say you finished one.', [tx('type', 'Type'), nu('mins', 'Minutes', 'min'), sc('rpe', 'Effort (1–10)'), tx('note', 'Notes')], { fresh: 120 }),
  D(45, 'move', 'How do you feel 15–60 minutes after that session?', 'After a high-effort session.', [sc('energy', 'Energy'), sc('mood', 'Mood'), tx('note', 'Symptoms or notes')], { fresh: 120, safety: 'symptom' }),
  D(46, 'move', 'Any soreness or unusual pain from yesterday’s activity?', 'The day after strenuous or new exercise.', [ch('pain', 'Pain', ['None', 'Normal soreness', 'Unusual pain']), tx('where', 'Where'), sc('severity', 'How strong (1–10)')], { fresh: 900, safety: 'pain' }),
  D(47, 'move', 'How much walking or movement did you get today?', 'Evening, if movement is a goal and no sensor is connected.', [nu('mins', 'Minutes', 'min'), nu('steps', 'Steps, if you know', ''), ch('rough', 'Or roughly', ['Low', 'Normal', 'High'])], { fresh: 900 }),
  D(48, 'move', 'You’re partway through your weekly movement goal. Does it still fit this week?', 'Weekly progress review.', [ch('fit', 'Goal', ['Still fits', 'Reduce', 'Increase', 'Pause'])], { fresh: 6 * 1440 }),
  D(49, 'move', 'You mentioned pain. Is it affecting normal movement or getting worse?', 'Follow-up to a pain you reported.', [ch('aff', 'It is', ['Not affecting me', 'Somewhat', 'Yes, affecting me', 'Getting worse']), tx('note', 'Anything else')], { fresh: 600, safety: 'pain' }),
  D(50, 'move', 'Would a recovery-focused day fit better than another hard session?', 'You train often and your energy or soreness suggests it — only if you train regularly.', [ch('do', 'Choose', ['Keep the hard session', 'Lighter session', 'Recovery day', 'Decide later'])], { fresh: 900 }),
  // F — work & focus
  D(51, 'work', 'What’s the single most important task to move forward next?', 'Start of a work period, or when many open tasks compete.', [tx('task', 'Task')], { fresh: 300 }),
  D(52, 'work', 'You’ve postponed this task several times. What’s getting in the way?', 'A task was rescheduled 3 or more times (a UX heuristic).', [ch('why', 'It is', ['Too big', 'Unclear', 'Wrong time', 'Not important', 'Waiting on someone', 'Something else'])], { fresh: 1440, perItem: true }),
  D(53, 'work', 'How focused were you during that work block?', 'After a timed focus session.', [sc('focus', 'Focus'), nu('interruptions', 'Interruptions, if you counted', '')], { fresh: 60 }),
  D(54, 'work', 'What pulled you away from the task?', 'After you ended a focus block early.', [ch('why', 'Cause', ['Message or call', 'Another task', 'Fatigue', 'Hunger', 'Stress', 'Environment', 'Something else'])], { fresh: 60 }),
  D(55, 'work', 'Is this task done, partly done, blocked or no longer needed?', 'A task’s end window, or it’s overdue.', [ch('st', 'Status', ['Done', 'Partly done', 'Blocked', 'Drop it'])], { fresh: 1440, perItem: true }),
  D(56, 'work', 'This is overdue. Keep it today, move it, delegate it, or drop it?', 'An overdue, non-critical task.', [ch('do', 'Choose', ['Keep today', 'Move it', 'Delegate', 'Drop it'])], { fresh: 1440, perItem: true }),
  D(57, 'work', 'That task took longer or shorter than expected. Want LifeOS to learn from it?', 'Actual time differs a lot from your estimate.', [ch('learn', 'Learn from it', ['Yes', 'No']), tx('why', 'Why (optional)')], { fresh: 1440, perItem: true }),
  D(58, 'work', 'Your remaining work no longer fits comfortably into today. What can move?', 'Estimated remaining work is longer than your free time.', [ch('do', 'Choose', ['Move some tasks', 'Extend the day', 'Keep everything', 'Suggest a plan'])], { fresh: 300 }),
  D(59, 'work', 'Did that break help?', 'After a break you planned or accepted.', [ch('help', 'It', ['Yes', 'A little', 'No'])], { fresh: 120 }),
  D(60, 'work', 'Are you done with work for today?', 'Near your usual shutdown time, or after your last task.', [ch('done', 'Work', ['Done', 'One thing left', 'Working late'])], { fresh: 600 }),
  // G — schedule & events
  D(61, 'plan', 'What do you want to add?', 'Whenever you open Capture or the + button.', [tx('text', 'Type it naturally — meeting, task, deadline or plan')], { fresh: 0, capture: true }),
  D(62, 'plan', 'I have the event, but I’m missing one detail. What should I use?', 'A parsed event is missing one material detail.', [tx('detail', 'Time, duration or location')], { fresh: 0, capture: true }),
  D(63, 'plan', 'Does this event need preparation?', 'A new important meeting, interview or presentation.', [ch('prep', 'Preparation', ['None', 'Light', 'Moderate', 'Significant']), tx('what', 'What (optional)')], { fresh: 1440, perEvent: true }),
  D(64, 'plan', 'Your event is in a few days. Anything still unclear or unfinished?', 'An important event is 2–7 days away.', [ch('state', 'You are', ['Ready', 'Items remaining', 'Unsure']), tx('left', 'What’s left')], { fresh: 1440, perEvent: true }),
  D(65, 'plan', 'Tomorrow’s event looks important. What would make you feel fully ready?', 'The day before an important event, if prep seems unfinished.', [tx('ready', 'What would help'), sc('confidence', 'Confidence today (1–10)')], { fresh: 1440, perEvent: true }),
  D(66, 'plan', 'Your event starts soon. How’s your energy and stress right now?', '1–3 hours before an important event.', [sc('energy', 'Energy'), sc('stress', 'Stress')], { fresh: 180, perEvent: true }),
  D(67, 'plan', 'Do you need travel or setup time before this?', 'An in-person or video event where that’s unknown.', [nu('travel', 'Travel (min)', 'min'), nu('setup', 'Setup (min)', 'min'), ch('none', 'Or', ['Neither'])], { fresh: 1440, perEvent: true }),
  D(68, 'plan', 'Two things overlap. Which one wins, or should I suggest a fix?', 'A calendar conflict was found.', [ch('win', 'Choose', ['First one', 'Second one', 'Suggest a fix', 'Both can overlap'])], { fresh: 1440, perItem: true }),
  D(69, 'plan', 'At the current pace, this deadline may be tight. How much work is actually left?', 'Remaining estimated work is close to the free time before a deadline.', [nu('hours', 'Hours left', 'h'), ch('unsure', 'Or', ['Not sure'])], { fresh: 1440, perItem: true }),
  D(70, 'plan', 'How did that event go?', 'After an important event, if you opted into debriefs.', [sc('outcome', 'Outcome'), sc('stress', 'Stress during'), ch('prepared', 'Was preparation enough?', ['Yes', 'Not quite', 'More than needed']), tx('note', 'Notes')], { fresh: 1440, perEvent: true, optin: 'debrief' }),
  // H — mood, stress, social
  D(71, 'mind', 'How are you feeling right now?', 'When your last mood entry is stale or something meaningful changed.', [sc('mood', 'Mood'), mu('tags', 'Feelings', ['Calm', 'Happy', 'Tired', 'Anxious', 'Irritable', 'Sad', 'Focused', 'Restless'])], { fresh: 240 }),
  D(72, 'mind', 'Your stress jumped from earlier. Do you know what changed?', 'Stress is clearly above your earlier rating or baseline.', [ch('src', 'Mostly', ['Work', 'Money', 'Health', 'Family', 'An event', 'Unclear', 'Something else'])], { fresh: 240, safety: 'mood' }),
  D(73, 'mind', 'You seem nervous about this event. Want help preparing or settling down?', 'You rated stress high before an event — never inferred from anything else.', [ch('help', 'I’d like', ['Prepare', 'Settle down', 'Both', 'Leave me alone'])], { fresh: 600, perEvent: true }),
  D(74, 'mind', 'Did something happen today that affected your mood?', 'A large mood shift with no context, or when you open the journal.', [tx('what', 'What happened'), ch('private', 'Keep it', ['Normal', 'Private']), ch('skip', 'Or', ['Prefer not to say'])], { fresh: 900, safety: 'mood' }),
  D(75, 'mind', 'Would some connection with someone matter today, or are you fine as you are?', 'Only if social connection is a goal of yours and several days passed without any.', [ch('c', 'Today', ['I’m fine', 'Yes', 'Already planned', 'Not today'])], { fresh: 3 * 1440, optin: 'social' }),
  D(76, 'mind', 'Did you get the family or personal time you wanted today?', 'Evening, when you planned it or made it a priority.', [ch('t', 'You got', ['Yes', 'Partly', 'No', 'Not applicable'])], { fresh: 900 }),
  D(77, 'mind', 'Did that breathing, walk or quiet-time reset actually help?', 'After a stress reset you chose.', [ch('help', 'It', ['Yes', 'A little', 'No'])], { fresh: 120 }),
  D(78, 'mind', 'You’ve got several pressures at once. What needs attention first?', 'A heavy load and high reported stress together.', [ch('first', 'First', ['An urgent task', 'My health', 'Money', 'Family', 'Rest', 'Unsure'])], { fresh: 600 }),
  D(79, 'mind', 'What went well today that you want LifeOS to remember?', 'An optional evening reflection, rarely.', [tx('good', 'What went well')], { fresh: 3 * 1440 }),
  D(80, 'mind', 'Your stress has stayed high across several check-ins. Are you coping okay, or do you want outside support?', 'High self-reported stress over several days — a product heuristic, not a diagnosis.', [ch('coping', 'I am', ['Coping okay', 'Want support', 'Not sure'])], { fresh: 7 * 1440, safety: 'mood' }),
  // I — money & admin
  D(81, 'money', 'Want to log that expense?', 'When you type a purchase or open finance capture.', [nu('amount', 'Amount', ''), tx('category', 'Category'), tx('note', 'Note')], { fresh: 0, optin: 'finance', capture: true }),
  D(82, 'money', 'This bill is due soon. Is it already paid, scheduled, or still pending?', 'A bill you configured is near its due date.', [ch('st', 'Status', ['Paid', 'Scheduled', 'Pending', 'Amount changed'])], { fresh: 1440, optin: 'finance', perItem: true }),
  D(83, 'money', 'That spend is larger than your usual. Was it planned?', 'An expense above your own usual range.', [ch('plan', 'It was', ['Planned', 'Unexpected', 'Essential', 'Reimbursable', 'Amount is wrong'])], { fresh: 1440, optin: 'finance', perItem: true }),
  D(84, 'money', 'Thinking about buying something? Want to see what it changes?', 'Only when you ask a purchase question.', [nu('price', 'Price', ''), tx('when', 'When'), ch('prio', 'Priority', ['High', 'Medium', 'Low'])], { fresh: 0, optin: 'finance', capture: true }),
  D(85, 'money', 'Anything unusual coming in or going out over the next 30 days?', 'A weekly or monthly review when your outlook is sparse.', [tx('items', 'What, how much, when — or leave empty for none')], { fresh: 7 * 1440, optin: 'finance' }),
  D(86, 'money', 'How important is this savings goal right now?', 'A periodic goal review.', [ch('prio', 'It is', ['High', 'Medium', 'Low', 'Pause it'])], { fresh: 14 * 1440, optin: 'finance' }),
  D(87, 'money', 'You’ve paid for this subscription repeatedly. Is it still useful?', 'A recurring payment you track.', [ch('keep', 'Subscription', ['Keep', 'I’ll cancel it myself', 'Remind me later', 'Unsure'])], { fresh: 30 * 1440, optin: 'finance', perItem: true }),
  D(88, 'money', 'A small admin task keeps hanging around. Do it, schedule it, or drop it?', 'A life-admin task has been deferred repeatedly.', [ch('do', 'Choose', ['Do it now', 'Schedule it', 'Drop it'])], { fresh: 1440, perItem: true }),
  D(89, 'money', 'Is money contributing to your stress today?', 'High stress soon after a financial event, or if you enabled it.', [ch('m', 'Money is', ['Not really', 'A little', 'Yes', 'Prefer not to say'])], { fresh: 3 * 1440, optin: 'finance', safety: 'mood' }),
  D(90, 'money', 'Anything in your money picture this week that surprised you?', 'A weekly finance reflection.', [ch('s', 'Surprise', ['No', 'Spending', 'Income', 'A bill', 'A goal', 'Something else'])], { fresh: 7 * 1440, optin: 'finance' }),
  // J — evening & learning
  D(91, 'review', 'How did today actually go?', 'Evening close-out, or when you tap Finish day.', [sc('overall', 'Overall'), tx('note', 'A line about it')], { fresh: 900 }),
  D(92, 'review', 'You didn’t do this planned item. What happened?', 'A high-priority or repeated item was missed.', [ch('why', 'Reason', ['No time', 'Forgot', 'Low energy', 'Priority changed', 'Not relevant', 'Something else'])], { fresh: 1440, perItem: true }),
  D(93, 'review', 'What helped your energy today?', 'Evening, when energy improved or you’re running an experiment.', [tx('helped', 'What helped')], { fresh: 1440 }),
  D(94, 'review', 'What drained you most today?', 'Evening after a heavy or stressful day.', [tx('drain', 'What drained you')], { fresh: 1440 }),
  D(95, 'review', 'What should carry over to tomorrow?', 'End of day, when items are unfinished.', [ch('carry', 'Carry over', ['Nothing', 'Selected tasks', 'Suggest for me'])], { fresh: 900 }),
  D(96, 'review', 'Are you ready to wind down, or is something important still left?', 'Near your planned sleep time, with unfinished commitments.', [ch('rd', 'You are', ['Winding down', 'One more task', 'Not sleeping yet'])], { fresh: 300 }),
  D(97, 'review', 'Here’s what I think happened today. Anything wrong or missing?', 'After the daily summary.', [ch('ok', 'The summary', ['Looks right', 'Something is wrong', 'Something is missing']), tx('fix', 'Correction')], { fresh: 900 }),
  D(98, 'review', 'What changed this week — health, work, plans, money or priorities?', 'Weekly review.', [mu('areas', 'Changed', ['Health', 'Work', 'Plans', 'Money', 'Priorities', 'Nothing']), tx('detail', 'Detail')], { fresh: 6 * 1440 }),
  D(99, 'review', 'I’ve noticed a possible pattern. Does it match your experience?', 'Only after enough comparable observations (5 or more).', [ch('m', 'It', ['Yes', 'Maybe', 'No', 'Keep watching'])], { fresh: 3 * 1440 }),
  D(100, 'review', 'Here’s what LifeOS remembers about you. What should I correct, forget, keep temporary or mark private?', 'Monthly, or whenever you ask.', [ch('go', 'Review', ['Open my memories'])], { fresh: 30 * 1440 }),
];
export const BY_ID = new Map(CHECKINS.map((c) => [c.id, c]));
export const get = (id) => BY_ID.get(Number(id)) || null;
