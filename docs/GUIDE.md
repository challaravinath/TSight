# TSight User Guide

**Complete guide to all TSight features and how to use them effectively.**

---

## Table of Contents

1. [Overview Tab](#overview-tab)
2. [Issues Tab](#issues-tab)
3. [Files Tab](#files-tab)
4. [Search Tab](#search-tab)
5. [Git Insights Tab](#git-insights-tab)
6. [File Detail Panel](#file-detail-panel)

---

## Overview Tab

The Overview tab gives you a high-level snapshot of your codebase health.

### Key Metrics

| Metric | What it means |
|--------|---------------|
| **Files** | Total TypeScript/JavaScript files analyzed |
| **Functions** | Total functions and methods found |
| **Classes** | Total class definitions |
| **Avg Complexity** | Average cyclomatic complexity score |

### Health Score

The Health Score (0-100) is calculated from:
- Code complexity
- Dependency depth
- Issue count
- Duplication rate

**Score Ranges:**
- 🟢 80-100: Excellent
- 🟡 60-79: Good
- 🟠 40-59: Needs attention
- 🔴 0-39: Critical

### Core Files

Files imported by 5+ other files. These are your **foundation** — changes here have wide impact.

### Hotspots

Files with high complexity AND high number of dependents:
```
Risk Score = Complexity × Dependents
```
Higher score = riskier to change without careful testing.

---

## Issues Tab

The Issues tab uses an **accordion layout** with confidence levels to help you prioritize.

### Confidence Levels

| Badge | Color | Meaning |
|-------|-------|---------|
| **Certain** | 🟢 Green | Verified facts — safe to act on |
| **Maybe** | 🟡 Yellow | Possible issues — use judgment |

### Sections

#### 📋 Exact Duplicates [Certain]
Files with 100% identical content (byte-for-byte match). These should definitely be consolidated.

#### ⚠️ Code Issues [Certain]
- **Circular Dependencies**: A imports B imports A (causes bundling issues)
- **High Complexity**: Functions with cyclomatic complexity > 20

#### 🔍 Structural Twins [Maybe]
Functions with similar structure (same parameters, return type, control flow). May or may not be actual duplicates — **review before refactoring**.

Displayed as a folder tree:
```
📁 src/api/
   ├── fetchUserData() ↔ loadAccountInfo()  [7/8]
   └── validateInput() ↔ checkParams()      [6/8]
```

The `[7/8]` indicates how many of 8 structural criteria matched.

#### ❓ Potentially Unused [Maybe]
Files with no imports found. Could be:
- Entry points (index.ts)
- Test files
- Dynamically loaded modules
- Actually unused

---

## Files Tab

Browse your entire codebase as a folder tree.

### Features
- Click any file to open the **File Detail Panel**
- See file sizes and line counts
- Visual hierarchy matches your project structure

---

## Search Tab

Find any class, function, or file instantly.

### How to Use
1. Type at least 2 characters
2. Results grouped by type (Class, Function, File)
3. Click any result to open File Detail

### Search Tips
- Search by filename: `UserService`
- Search by function name: `handleSubmit`
- Search partial matches: `fetch` finds `fetchUser`, `fetchData`, etc.

---

## Git Insights Tab

**Requires**: Project must be a git repository with history.

### File Churn

Files changed most frequently in the last 90 days.

**Why it matters**: High churn + high complexity = 🔥 risk

| Column | Meaning |
|--------|---------|
| Changes | Number of commits touching this file |
| Authors | Number of different contributors |
| Last Changed | Most recent commit date |

**Badge**: Shows count of "hot" files (5+ changes)

---

### Ownership

Who knows each file best, based on commit history.

#### Time Filter

| Filter | Shows |
|--------|-------|
| **All Time** | Historical owners (entire git history) |
| **Last 6 months** | Only commits from last 6 months |
| **Last 3 months** | Only commits from last 3 months |

**Important**: When you filter by time, the Primary Owner is recalculated based **only on commits in that period**.

#### Knowledge Gaps 🚨

When using time filters, TSight shows files with **zero commits** in the selected period.

```
🚨 Knowledge Gaps                                    [23]
   These files have zero commits in the selected time period.
   No one on the team has touched this code recently.
   
   [OldPayment.ts] [legacy.ts] [deprecated.ts] +20 more
```

**This is critical for teams who recently took over a codebase** — it shows which files have no recent team knowledge.

#### Ownership Stats

| Stat | Meaning |
|------|---------|
| Primary Owner | Person with most commits (in selected time period) |
| Ownership % | What % of commits are by the primary owner |
| Commits | Total commits to this file (in period) |
| Contributors | List of people who touched this file |

---

### Bus Factor

Files where only **one person** has ever committed. If that person leaves, no one knows the code.

| Metric | Meaning |
|--------|---------|
| **X% risk** | Percentage of files with single author |
| **Solo Files** | Count per author |

#### Expandable Author View

Click any author to see all their solo files, grouped by folder:

```
▼ 👤 Arvind Venkataraman                    [149 solo files]
  
  📁 src/components/                         (45)
     ├── AutomaticFrequencySubStepRenderer.tsx    →
     ├── AutomaticScheduleSubStepRenderer.tsx     →
     └── ScheduleFormRenderer.styles.ts           →
  
  📁 src/types/                              (23)
     ├── DataflowTypes.ts                         →
     └── RefreshSettingsDayOfWeekPicker.tsx       →
```

Click any file to open its detail panel.

---

## File Detail Panel

Click any file anywhere in TSight to open the detail panel.

### Sections

#### Summary
- File path and name
- Lines of code
- Complexity score
- Language

#### Dependencies
- **Imports**: What this file imports
- **Imported By**: What files import this one (your dependents)

#### Contents
- Classes defined in this file
- Functions defined in this file
- Interfaces and types

#### Blast Radius 💥
Click "Show Blast Radius" to see:
- Direct dependents (1 hop)
- Indirect dependents (2+ hops)
- Total files affected if you change this file

---

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Esc` | Close any open panel/modal |
| `/` | Focus search (when available) |

---

## Tips for Teams

### For New Team Members
1. Start with **Overview** to understand codebase size
2. Check **Core Files** to find the foundation
3. Use **Search** to find specific components

### For Tech Leads
1. Check **Hotspots** before sprint planning
2. Review **Bus Factor** for knowledge risks
3. Use **Blast Radius** before major refactors

### For Teams Taking Over a Codebase
1. Go to **Git Insights → Ownership**
2. Set time filter to **Last 6 months** (or when your team started)
3. Review **Knowledge Gaps** — these files need documentation or pairing

---

## The TSight Philosophy

**Every number is real.**

- "47 files depend on this" → Exactly 47 files
- "Risk Score 612" → Complexity (18) × Dependents (34)
- "100% duplicate" → Byte-for-byte identical
- "Knowledge Gap" → Zero commits in time period

No AI guessing. No estimates. Just facts from your actual code and git history.

---

**TSight: See your code. For real.**
