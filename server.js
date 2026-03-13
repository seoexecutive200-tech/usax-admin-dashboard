const path = require('path');
const express = require('express');
const session = require('express-session');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'usax123';

const activity = [
  { timestamp: '2026-03-13 09:15', adminUser: 'Admin', module: 'Missed Appointments', action: 'Opened bot module', status: 'Success', notes: 'Ready for follow-up workflow' },
  { timestamp: '2026-03-13 08:52', adminUser: 'Admin', module: 'Lead Listing', action: 'Reviewed bot page', status: 'Success', notes: 'Internal lead review' },
  { timestamp: '2026-03-13 08:21', adminUser: 'Ops User', module: 'Driver Onboarding', action: 'Started onboarding intake', status: 'Pending', notes: 'Awaiting operator input' },
  { timestamp: '2026-03-13 07:58', adminUser: 'Ops User', module: 'Power Only Leads', action: 'Opened leads module', status: 'Success', notes: 'Module healthy' }
];

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET || 'change-this-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 8 }
}));

app.use('/static', express.static(path.join(__dirname, 'public')));

function requireAuth(req, res, next) {
  if (req.session && req.session.authenticated) return next();
  return res.redirect('/');
}

app.get('/', (req, res) => {
  if (req.session && req.session.authenticated) {
    return res.redirect('/dashboard');
  }
  res.sendFile(path.join(__dirname, 'public', 'pages', 'login.html'));
});

app.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
    req.session.authenticated = true;
    req.session.username = username;
    return res.redirect('/dashboard');
  }
  return res.redirect('/?error=1');
});

app.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

app.get('/dashboard', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'pages', 'dashboard.html'));
});

app.get('/page/:name', requireAuth, (req, res) => {
  const allowed = new Set([
    'missed-appointments',
    'lead-listing',
    'driver-onboarding',
    'power-only',
    'ebook-proposal',
    'history',
    'settings'
  ]);

  const page = req.params.name;
  if (!allowed.has(page)) return res.status(404).send('Not found');
  res.sendFile(path.join(__dirname, 'public', 'pages', `${page}.html`));
});

app.get('/api/system-status', requireAuth, (req, res) => {
  res.json({
    status: 'Healthy',
    activeModules: 4,
    reservedModules: 1,
    uptimeMode: 'Mock',
    user: req.session.username || 'Admin'
  });
});

app.get('/api/submission-history', requireAuth, (req, res) => {
  res.json(activity);
});

app.listen(PORT, () => {
  console.log(`USAX Admin Dashboard running on http://localhost:${PORT}`);
});
