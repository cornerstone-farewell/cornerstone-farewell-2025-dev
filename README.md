# 🎓 Cornerstone International School - Farewell 2025

A complete farewell memory website system with file uploads, admin panel, and memory wall.

## 🚀 Quick Start

### 1. Clone Repository now
```bash
git clone https://github.com/YOUR_USERNAME/cornerstone-farewell.git
cd cornerstone-farewell
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Create Required Folders
```bash
mkdir -p uploads database
```

### 4. Start Server
```bash
# Development
node server.js

# Production (with PM2)
npm install -g pm2
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

### 5. Access Website
- **Website:** `http://YOUR_SERVER_IP:3000`
- **Admin Panel:** Click logo 5 times OR go to `http://YOUR_SERVER_IP:3000/#admin`
- **Admin Password:** `cornerstone2025` (change in server.js)

## 📦 Features

- ✅ Drag & drop file uploads (images + videos)
- ✅ 200MB total upload limit per submission
- ✅ Memory wall with masonry grid
- ✅ Admin approval system
- ✅ Like functionality
- ✅ Download all as ZIP
- ✅ SQLite database (no external DB needed)
- ✅ Auto-restart with PM2
- ✅ Mobile responsive

## 🔧 Configuration

Edit `server.js` to change:
- `ADMIN_PASSWORD` - Admin login password
- `PORT` - Server port (default: 3000)
- `MAX_TOTAL_SIZE` - Max upload size (default: 200MB)

## 📂 File Storage

- **Uploads:** `./uploads/` folder
- **Database:** `./database/memories.db`

## 🔄 After VM Restart

If using PM2:
```bash
pm2 resurrect
```

If not using PM2:
```bash
cd cornerstone-farewell
node server.js
```

## 🛡️ Security Notes

1. Change the admin password immediately
2. Set up HTTPS with nginx reverse proxy
3. Configure firewall (allow port 3000)
4. Regular backups of uploads/ and database/ folders

## 📜 License

MIT License - Cornerstone International School 2025