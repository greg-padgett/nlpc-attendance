# NLPC Church Attendance Tracker

## 🚀 Serverless + Cloud-Based

- **Frontend**: HTML/CSS/JavaScript (hosted on Netlify)
- **Backend**: Serverless functions (Netlify Functions)
- **Database**: PostgreSQL (Neon)
- **Deployment**: One command to production

---

## 📁 Project Structure

```
NLPC-Attendance/
├── frontend/
│   └── index.html           ← Your app (all features here)
├── netlify/
│   └── functions/
│       ├── api.js           ← Serverless backend (connects to Neon)
│       └── package.json     ← Function dependencies
├── netlify.toml             ← Netlify configuration
├── package.json             ← Project configuration
├── .env                     ← Database connection (Neon)
├── .gitignore               ← Git ignore rules
└── DEPLOY-NOW.md            ← Deployment instructions
```

---

## 🎯 Features

✅ Record attendance for multiple service types
✅ Manage church members (add, view, delete)
✅ Generate attendance reports by date range
✅ Fully responsive design (mobile/tablet/desktop)
✅ Real-time data synced to Neon database
✅ Serverless (no servers to manage)
✅ Zero setup friction (deploy with one command)

---

## 📋 Service Types

- Sunday Morning
- Sunday Evening
- Wednesday Night
- Prayer Meeting
- Youth Group

_(Edit `frontend/index.html` to add more)_

---

## 🚀 Quick Start (Deployment)

### Prerequisites
- Netlify account (free at [netlify.com](https://netlify.com))
- Neon account (free at [neon.tech](https://neon.tech))
- Node.js installed locally

### Deploy in 5 Minutes

1. Install Netlify CLI:
   ```bash
   npm install -g netlify-cli
   ```

2. Login to Netlify:
   ```bash
   netlify login
   ```

3. Deploy:
   ```bash
   cd ~/Documents/NLPC-Attendance
   netlify init
   ```

4. Set environment variable:
   ```bash
   netlify env:set DATABASE_URL "your-neon-connection-string"
   ```

5. Deploy to production:
   ```bash
   netlify deploy --prod
   ```

**Done!** Your app is live at `https://nlpc-attendance.netlify.app`

---

## 🧪 Local Testing

Before deploying to production, test locally:

```bash
cd ~/Documents/NLPC-Attendance
npm install
netlify dev
```

Then visit: `http://localhost:8888`

All functions and database calls will work exactly like production.

---

## 📊 How It Works

### Architecture

```
Browser (Your Computer)
    ↓ HTTPS
Netlify CDN (frontend/index.html)
    ↓ JavaScript fetch()
Netlify Functions (netlify/functions/api.js)
    ↓ PostgreSQL driver
Neon Database (PostgreSQL)
```

### Data Flow

1. **Add Member**:
   - User fills form in browser
   - JavaScript POSTs to `/.netlify/functions/api/members`
   - Function inserts into Neon database
   - Response returns to browser, member appears in list

2. **Record Attendance**:
   - User selects members and clicks "Save Attendance"
   - JavaScript POSTs to `/.netlify/functions/api/attendance`
   - Function inserts record into Neon
   - Data persists across browser sessions

3. **View Reports**:
   - User selects date range and clicks "Generate Report"
   - JavaScript GETs from `/.netlify/functions/api/attendance/report?from=...&to=...`
   - Function queries Neon, calculates totals
   - Response includes stats and service breakdown

---

## 🔐 Security

- ✅ Database credentials stored securely in Netlify environment
- ✅ Connection uses SSL/TLS encryption
- ✅ Netlify handles CORS headers automatically
- ✅ No sensitive data in code or git

---

## 📝 Configuration

### Change Service Types

Edit `frontend/index.html`, find this section:

```html
<select id="serviceType">
    <option value="">Select a service</option>
    <option value="Sunday Morning">Sunday Morning</option>
    <option value="Sunday Evening">Sunday Evening</option>
    <!-- Add more here -->
</select>
```

### Change Colors

Edit CSS variables in `frontend/index.html` (top of `<style>` section):

```css
:root {
    --color-primary: #2180A1;        /* Main blue */
    --color-success: #32B8C6;        /* Green */
    --color-error: #C01A2F;          /* Red */
    --color-text: #134252;           /* Text color */
    /* etc */
}
```

---

## 🔧 Troubleshooting

### "Cannot connect to database"
- Verify DATABASE_URL is set: `netlify env:list`
- Check Neon dashboard - is database running?
- Verify connection string is correct

### "Functions not working"
- Check logs: `netlify logs`
- Ensure all dependencies installed: `npm install`
- DATABASE_URL must be set before deploying

### "Frontend loads but buttons don't work"
- Check browser console (F12 → Console tab) for errors
- Verify API_BASE is correct: `/.netlify/functions/api`
- Check network tab (F12 → Network) to see API requests

---

## 📞 Support

### Resources
- **Netlify Docs**: [docs.netlify.com](https://docs.netlify.com)
- **Neon Docs**: [neon.tech/docs](https://neon.tech/docs)
- **Deployment Guide**: See `DEPLOY-NOW.md`

---

## 📄 License

MIT - Use freely for your church.

---

## ✅ Checklist for Production

- [ ] Reviewed all service types in frontend
- [ ] Tested locally with `netlify dev`
- [ ] DATABASE_URL set in Netlify environment
- [ ] Deployed with `netlify deploy --prod`
- [ ] Tested live site (add member, record attendance, generate report)
- [ ] Shared URL with church team
- [ ] Created backups or export procedure

---

**Ready to go live?** Run: `netlify deploy --prod`

🎉 Your serverless attendance tracker is now live!
