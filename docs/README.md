# 🔍 TSight

**Understand any TypeScript codebase in 30 seconds.**

> No AI. No guessing. Just facts from your code.

---

## ✨ What You Get

| Feature | What It Shows |
|---------|---------------|
| 🧠 **Mental Model** | Architecture layers at a glance |
| 🔥 **Hotspots** | Complex + heavily used = risky to change |
| 💥 **Blast Radius** | "If I change this, what breaks?" |
| 🚌 **Bus Factor** | Who knows what? Knowledge risk |
| 📋 **Issues** | Duplicates, circular deps, unused files |
| 🗺️ **Codebase Map** | Export docs for new team members |

---

## 🚀 Quick Start

### Windows
```
Double-click start.bat
```

### Mac / Linux
```bash
chmod +x start.sh && ./start.sh
```

Opens automatically at **http://localhost:3000**

---

## 📸 Screenshots

<details>
<summary>Click to see screenshots</summary>

### Dashboard
*Overview of your codebase health*

### Hotspots
*Files that are complex AND heavily used*

### Git Insights
*Who knows what? Bus factor analysis*

### Blast Radius
*See impact before you refactor*

</details>

---

## 💡 The Principle

**Every number is real.**

- We say "47 files depend on this" → That's exactly 47 files
- We say "Risk Score 612" → That's `Complexity (18) × Dependents (34)`
- We say "100% duplicate" → Byte-for-byte identical
- We say "Bus Factor 50%" → 50% of files have only one author

**No AI hallucinations. No fuzzy estimates. Just facts you can verify.**

---

## 🎯 Who Is This For?

- **New to a codebase?** Get oriented in minutes, not days
- **Tech lead?** Find where knowledge is concentrated
- **Refactoring?** Know the blast radius before you start
- **Onboarding someone?** Export a codebase map for them

---

## 🛠️ How It Works

TSight runs **100% locally**:
1. Parses your TypeScript/React files with [ts-morph](https://ts-morph.com/)
2. Builds a dependency graph
3. Reads your `.git` folder for team insights (no API token needed)
4. Shows you the results in a clean UI

**Your code never leaves your machine.**

---

## 📁 Project Structure

```
tsight/
├── packages/
│   ├── core/       # Analysis engine (ts-morph)
│   ├── api/        # REST API (Express)
│   └── web/        # UI (React + Vite)
├── start.bat       # Windows launcher
└── start.sh        # Mac/Linux launcher
```

---

## 🔧 Manual Setup

```bash
# Install dependencies
npm install

# Build
npm run build --workspace=@tsight/core
npm run build --workspace=@tsight/api

# Start API (terminal 1)
cd packages/api && npm start

# Start Web (terminal 2)  
cd packages/web && npm run dev
```

---

## 🐳 Docker

No Node.js? Use Docker:

```bash
# Build
docker build -t tsight .

# Run (mount your code folder)
docker run -p 3000:3000 -v "/path/to/your/code:/code" tsight
```

Open http://localhost:3000 and enter `/code/YourProject`

---

## 📋 Requirements

- **Node.js 18+** or **Docker**
- Works on **any TypeScript/React** project

---

## 🤝 Contributing

Contributions welcome! Please read the code, run it locally, and submit a PR.

---

## 📄 License

MIT

---

<p align="center">
  <strong>TSight: See your code. For real.</strong>
</p>
