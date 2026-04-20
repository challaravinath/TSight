/**
 * TSight API Server
 */

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { simpleGit } from 'simple-git';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { fileURLToPath } from 'url';
import { Analyzer, AnalysisResult } from '@tsight/core';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT) || 3001;
const HOST = process.env.HOST || '127.0.0.1';

// ============================================================================
// SECURITY: input validation & resource limits
// ============================================================================

// If set, every analyze target must resolve inside this directory.
// In Docker we set this to /code; locally it can be left unset (the bind to
// 127.0.0.1 + CORS allowlist already prevent remote exploitation).
const WORKSPACE_ROOT = process.env.TSIGHT_WORKSPACE_ROOT
  ? path.resolve(process.env.TSIGHT_WORKSPACE_ROOT)
  : null;

// Strict allowlist for git clone targets. Rules out ssh, scp-style and the
// ext:: transport that historically allowed RCE via crafted URLs.
const GITHUB_URL_RE = /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?\/?$/;

const CLONE_TIMEOUT_MS = 60_000;
const CLONE_TMP_ROOT = path.join(os.tmpdir(), 'tsight-repos');
const CLONE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const ALLOWED_ORIGINS = (
  process.env.TSIGHT_CORS_ORIGIN || 'http://localhost:3000,http://localhost:3001'
)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

function validateProjectPath(input: unknown): string {
  if (typeof input !== 'string' || input.length === 0 || input.includes('\0')) {
    throw new Error('path must be a non-empty string');
  }
  const resolved = path.resolve(input);
  if (!fs.existsSync(resolved)) {
    throw new Error('Path does not exist');
  }
  if (!fs.statSync(resolved).isDirectory()) {
    throw new Error('Path must be a directory');
  }
  if (WORKSPACE_ROOT) {
    const real = fs.realpathSync(resolved);
    const rootReal = fs.realpathSync(WORKSPACE_ROOT);
    const rel = path.relative(rootReal, real);
    if (rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) {
      throw new Error('Path is outside the configured workspace root');
    }
  }
  return resolved;
}

function validateGitHubUrl(input: unknown): string {
  if (typeof input !== 'string' || !GITHUB_URL_RE.test(input)) {
    throw new Error('url must be an https://github.com/{owner}/{repo} URL');
  }
  return input;
}

function clampInt(input: unknown, min: number, max: number, fallback: number): number {
  const n = parseInt(String(input ?? ''), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function cleanupOldClones(): void {
  try {
    if (!fs.existsSync(CLONE_TMP_ROOT)) return;
    const cutoff = Date.now() - CLONE_MAX_AGE_MS;
    for (const name of fs.readdirSync(CLONE_TMP_ROOT)) {
      const p = path.join(CLONE_TMP_ROOT, name);
      try {
        if (fs.statSync(p).mtimeMs < cutoff) {
          fs.rmSync(p, { recursive: true, force: true });
        }
      } catch {
        // best-effort cleanup
      }
    }
  } catch {
    // best-effort cleanup
  }
}

// Serve static files in production (Docker)
if (process.env.NODE_ENV === 'production') {
  const webPath = path.join(__dirname, '../../web/dist');
  if (fs.existsSync(webPath)) {
    console.log('Serving static files from:', webPath);
    app.use(express.static(webPath));
  }
}

app.use(
  cors({
    origin: (origin, cb) => {
      // Same-origin or non-browser clients (curl, server-side) have no Origin.
      if (!origin) return cb(null, true);
      if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
      return cb(new Error('Origin not allowed'));
    },
  }),
);
app.use(express.json({ limit: '256kb' }));

// State
const analyzer = new Analyzer();
let currentAnalysis: AnalysisResult | null = null;
let currentProject: { path: string; name: string; status: string } | null = null;

// ============================================================================
// ROUTES
// ============================================================================

/**
 * Health check
 */
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    project: currentProject,
    hasAnalysis: currentAnalysis !== null,
  });
});

/**
 * Analyze a local folder
 */
app.post('/api/analyze', async (req, res) => {
  let projectPath: string;
  try {
    projectPath = validateProjectPath(req.body?.path);
  } catch (e) {
    return res.status(400).json({ success: false, error: (e as Error).message });
  }

  try {
    currentProject = {
      path: projectPath,
      name: path.basename(projectPath),
      status: 'analyzing',
    };

    // Run analysis
    currentAnalysis = await analyzer.analyze(projectPath);
    currentProject.status = 'ready';
    
    res.json({
      success: true,
      project: currentProject,
      stats: currentAnalysis.stats,
    });
  } catch (error) {
    currentProject = null;
    res.status(500).json({
      success: false,
      error: (error as Error).message,
    });
  }
});

/**
 * Clone and analyze a GitHub repo
 */
app.post('/api/analyze/github', async (req, res) => {
  let url: string;
  try {
    url = validateGitHubUrl(req.body?.url);
  } catch (e) {
    return res.status(400).json({ success: false, error: (e as Error).message });
  }

  const repoName = url.replace(/\/$/, '').replace(/\.git$/, '').split('/').pop() || 'repo';
  fs.mkdirSync(CLONE_TMP_ROOT, { recursive: true });
  const tempDir = path.join(CLONE_TMP_ROOT, `${repoName}-${Date.now()}`);

  currentProject = {
    path: tempDir,
    name: repoName,
    status: 'cloning',
  };

  try {
    console.log(`📥 Cloning ${url}...`);
    const git = simpleGit({ timeout: { block: CLONE_TIMEOUT_MS } });
    await Promise.race([
      git.clone(url, tempDir, ['--depth', '1', '--no-tags', '--single-branch']),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('git clone timed out')), CLONE_TIMEOUT_MS),
      ),
    ]);

    // Analyze
    currentProject.status = 'analyzing';
    currentAnalysis = await analyzer.analyze(tempDir);
    currentProject.status = 'ready';

    res.json({
      success: true,
      project: currentProject,
      stats: currentAnalysis.stats,
    });
  } catch (error) {
    fs.rmSync(tempDir, { recursive: true, force: true });
    currentProject = null;
    res.status(500).json({
      success: false,
      error: (error as Error).message,
    });
  }
});

/**
 * Get full analysis result
 */
app.get('/api/analysis', (req, res) => {
  if (!currentAnalysis) {
    return res.status(404).json({ success: false, error: 'No analysis available' });
  }
  
  res.json({
    success: true,
    data: currentAnalysis,
  });
});

/**
 * Get project overview (for dashboard)
 */
app.get('/api/overview', (req, res) => {
  if (!currentAnalysis) {
    return res.status(404).json({ success: false, error: 'No analysis available' });
  }
  
  res.json({
    success: true,
    project: currentProject,
    stats: currentAnalysis.stats,
    languages: currentAnalysis.languages,
    mentalModel: currentAnalysis.mentalModel,
    issues: currentAnalysis.issues.slice(0, 10),
    duplicates: currentAnalysis.duplicates.slice(0, 5),
  });
});

/**
 * Get files list
 */
app.get('/api/files', (req, res) => {
  if (!currentAnalysis) {
    return res.status(404).json({ success: false, error: 'No analysis available' });
  }
  
  res.json({
    success: true,
    files: currentAnalysis.files,
    folders: currentAnalysis.folders,
  });
});

/**
 * Get dependency graph
 */
app.get('/api/dependencies', (req, res) => {
  if (!currentAnalysis) {
    return res.status(404).json({ success: false, error: 'No analysis available' });
  }
  
  res.json({
    success: true,
    graph: currentAnalysis.dependencyGraph,
    externalPackages: currentAnalysis.externalPackages,
  });
});

/**
 * Get issues (dead code, duplicates, complexity)
 */
app.get('/api/issues', (req, res) => {
  if (!currentAnalysis) {
    return res.status(404).json({ success: false, error: 'No analysis available' });
  }
  
  res.json({
    success: true,
    issues: currentAnalysis.issues,
    duplicates: currentAnalysis.duplicates,
    complexity: currentAnalysis.complexity,
  });
});

/**
 * Get structural twins (honest similarity detection)
 * 
 * These are functions with identical STRUCTURE but different names.
 * We show exactly which criteria matched — no black-box scores.
 */
app.get('/api/structural-twins', (req, res) => {
  try {
    if (!currentAnalysis) {
      return res.status(404).json({ success: false, error: 'No analysis available' });
    }
    
    // Ensure we don't send too much data
    const twins = (currentAnalysis.structuralTwins || []).slice(0, 30);
    
    res.json({
      success: true,
      structuralTwins: twins,
      count: twins.length,
      total: currentAnalysis.structuralTwins?.length || 0,
      explanation: {
        what: 'Functions with identical structure but different names',
        how: 'We compare 8 discrete criteria: parameter count, parameter types, return type, async pattern, body size, control flow, error handling, and code patterns',
        why: 'Structural twins MAY be candidates for consolidation — review the criteria to decide',
        disclaimer: 'Structural similarity ≠ semantic equivalence. Two functions can look the same but serve different purposes.',
      },
    });
  } catch (error) {
    console.error('Error in /api/structural-twins:', error);
    res.status(500).json({ success: false, error: 'Failed to get structural twins' });
  }
});

/**
 * Search for code elements
 */
app.get('/api/search', (req, res) => {
  if (!currentAnalysis) {
    return res.status(404).json({ success: false, error: 'No analysis available' });
  }
  
  const rawQuery = typeof req.query.q === 'string' ? req.query.q : '';
  const query = rawQuery.slice(0, 200).toLowerCase();

  if (!query) {
    return res.status(400).json({ success: false, error: 'Query parameter q is required' });
  }
  
  const results: any[] = [];
  
  // Search classes
  for (const cls of currentAnalysis.classes) {
    if (cls.name.toLowerCase().includes(query)) {
      results.push({ resultType: 'class', ...cls });
    }
  }
  
  // Search functions
  for (const func of currentAnalysis.functions) {
    if (func.name.toLowerCase().includes(query)) {
      results.push({ resultType: 'function', ...func });
    }
  }
  
  // Search interfaces
  for (const iface of currentAnalysis.interfaces) {
    if (iface.name.toLowerCase().includes(query)) {
      results.push({ resultType: 'interface', ...iface });
    }
  }
  
  // Search files
  for (const file of currentAnalysis.files) {
    if (file.name.toLowerCase().includes(query) || file.path.toLowerCase().includes(query)) {
      results.push({ resultType: 'file', ...file });
    }
  }
  
  res.json({
    success: true,
    query,
    results: results.slice(0, 50),
    total: results.length,
  });
});

/**
 * Get dependency insights - REAL DATA only
 */
app.get('/api/insights', (req, res) => {
  if (!currentAnalysis) {
    return res.status(404).json({ success: false, error: 'No analysis available' });
  }
  
  const imports = currentAnalysis.imports;
  
  // Count how many files import each file (dependents)
  const dependentCount = new Map<string, number>();
  const importCount = new Map<string, number>();
  
  for (const imp of imports) {
    if (!imp.isExternal) {
      // Count dependents (who imports this file)
      dependentCount.set(imp.to, (dependentCount.get(imp.to) || 0) + 1);
      
      // Count imports (how many files does this file import)
      importCount.set(imp.from, (importCount.get(imp.from) || 0) + 1);
    }
  }
  
  // All files for tracking
  const allFiles = new Set(currentAnalysis.files.map(f => f.path));
  
  // Core files: imported by 5+ files
  const coreFiles = Array.from(dependentCount.entries())
    .filter(([, count]) => count >= 5)
    .sort((a, b) => b[1] - a[1])
    .map(([file, count]) => ({
      file,
      name: file.split('/').pop() || file,
      dependentCount: count
    }));
  
  // Complex files: import 10+ other files
  const complexFiles = Array.from(importCount.entries())
    .filter(([, count]) => count >= 10)
    .sort((a, b) => b[1] - a[1])
    .map(([file, count]) => ({
      file,
      name: file.split('/').pop() || file,
      importCount: count
    }));
  
  // Isolated files: no internal imports AND no dependents
  const filesWithImports = new Set([...dependentCount.keys(), ...importCount.keys()]);
  const isolatedFiles = currentAnalysis.files
    .filter(f => !filesWithImports.has(f.path))
    .filter(f => !f.path.includes('index.'))  // Skip index files
    .filter(f => !f.path.includes('.d.ts'))   // Skip type definitions
    .map(f => ({ file: f.path, name: f.name }));
  
  // Circular dependencies
  const circularDeps = currentAnalysis.dependencyGraph?.circular?.map(cycle => ({
    cycle
  })) || [];
  
  // === HOTSPOTS: Complexity × Dependents ===
  const hotspots = calculateHotspots(currentAnalysis, dependentCount);
  
  res.json({
    success: true,
    insights: {
      coreFiles,
      complexFiles,
      isolatedFiles,
      circularDeps,
      hotspots
    }
  });
});

/**
 * Calculate hotspots: files that are both complex AND heavily depended on
 * Risk = Complexity × Dependents (real formula, no magic)
 */
function calculateHotspots(analysis: any, dependentCount: Map<string, number>) {
  const hotspots: Array<{
    file: string;
    name: string;
    complexity: number;
    dependents: number;
    riskScore: number;
    riskLevel: 'critical' | 'high' | 'medium';
    functions: Array<{ name: string; complexity: number; line: number }>;
  }> = [];
  
  // Get complexity per file from functions
  const fileComplexity = new Map<string, { total: number; max: number; functions: Array<{ name: string; complexity: number; line: number }> }>();
  
  for (const func of analysis.functions) {
    const existing = fileComplexity.get(func.file) || { total: 0, max: 0, functions: [] };
    existing.total += func.complexity;
    existing.max = Math.max(existing.max, func.complexity);
    if (func.complexity >= 5) {  // Only track complex functions
      existing.functions.push({ name: func.name, complexity: func.complexity, line: func.line });
    }
    fileComplexity.set(func.file, existing);
  }
  
  // Also add class method complexity
  for (const cls of analysis.classes) {
    const existing = fileComplexity.get(cls.file) || { total: 0, max: 0, functions: [] };
    // Approximate: classes with many methods tend to be complex
    const methodComplexity = cls.methods * 2;
    existing.total += methodComplexity;
    fileComplexity.set(cls.file, existing);
  }
  
  // Calculate risk score for files with both complexity and dependents
  for (const [file, complexity] of fileComplexity) {
    const dependents = dependentCount.get(file) || 0;
    
    // Only include files that have BOTH complexity and dependents
    if (complexity.total >= 10 && dependents >= 3) {
      const riskScore = complexity.total * dependents;
      
      let riskLevel: 'critical' | 'high' | 'medium' = 'medium';
      if (riskScore >= 500) riskLevel = 'critical';
      else if (riskScore >= 200) riskLevel = 'high';
      
      hotspots.push({
        file,
        name: file.split('/').pop() || file,
        complexity: complexity.total,
        dependents,
        riskScore,
        riskLevel,
        functions: complexity.functions.sort((a, b) => b.complexity - a.complexity).slice(0, 5)
      });
    }
  }
  
  return hotspots.sort((a, b) => b.riskScore - a.riskScore).slice(0, 20);
}

/**
 * Get blast radius for a specific file
 * Shows exactly which files would be affected if this file changes
 */
app.get('/api/blast-radius/:filePath(*)', (req, res) => {
  if (!currentAnalysis) {
    return res.status(404).json({ success: false, error: 'No analysis available' });
  }
  
  const filePath = req.params.filePath;
  
  // Build adjacency list: file -> files that import it (reverse graph)
  const importedBy = new Map<string, Set<string>>();
  
  for (const imp of currentAnalysis.imports) {
    if (!imp.isExternal) {
      if (!importedBy.has(imp.to)) {
        importedBy.set(imp.to, new Set());
      }
      importedBy.get(imp.to)!.add(imp.from);
    }
  }
  
  // BFS to find all affected files at each level
  const visited = new Set<string>();
  const levels: Array<{ level: number; files: Array<{ file: string; name: string }> }> = [];
  
  let currentLevel = [filePath];
  let levelNum = 0;
  visited.add(filePath);
  
  while (currentLevel.length > 0 && levelNum < 5) {  // Max 5 levels deep
    const nextLevel: string[] = [];
    const levelFiles: Array<{ file: string; name: string }> = [];
    
    for (const file of currentLevel) {
      const dependents = importedBy.get(file) || new Set();
      
      for (const dep of dependents) {
        if (!visited.has(dep)) {
          visited.add(dep);
          nextLevel.push(dep);
          levelFiles.push({
            file: dep,
            name: dep.split('/').pop() || dep
          });
        }
      }
    }
    
    if (levelFiles.length > 0) {
      levelNum++;
      levels.push({ level: levelNum, files: levelFiles });
    }
    
    currentLevel = nextLevel;
  }
  
  // Calculate totals
  const directImpact = levels[0]?.files.length || 0;
  const indirectImpact = levels.slice(1).reduce((sum, l) => sum + l.files.length, 0);
  const totalImpact = directImpact + indirectImpact;
  const totalFiles = currentAnalysis.files.length;
  const percentageImpact = ((totalImpact / totalFiles) * 100).toFixed(1);
  
  // Determine risk level
  let riskLevel: 'low' | 'medium' | 'high' | 'critical' = 'low';
  if (totalImpact >= 50 || parseFloat(percentageImpact) >= 10) riskLevel = 'critical';
  else if (totalImpact >= 20 || parseFloat(percentageImpact) >= 5) riskLevel = 'high';
  else if (totalImpact >= 5) riskLevel = 'medium';
  
  res.json({
    success: true,
    blastRadius: {
      file: filePath,
      name: filePath.split('/').pop() || filePath,
      directImpact,
      indirectImpact,
      totalImpact,
      totalFiles,
      percentageImpact: parseFloat(percentageImpact),
      riskLevel,
      levels,
      // Include a simple message
      summary: totalImpact === 0 
        ? 'No other files depend on this file. Safe to modify.'
        : `Changing this file could affect ${totalImpact} files (${percentageImpact}% of codebase).`
    }
  });
});

/**
 * Get details for a specific file - INTERACTIVE VIEW
 */
app.get('/api/file/:filePath(*)', (req, res) => {
  if (!currentAnalysis) {
    return res.status(404).json({ success: false, error: 'No analysis available' });
  }
  
  const filePath = req.params.filePath;
  const file = currentAnalysis.files.find(f => f.path === filePath);
  
  if (!file) {
    return res.status(404).json({ success: false, error: 'File not found' });
  }
  
  // Get classes in this file
  const classes = currentAnalysis.classes.filter(c => c.file === filePath);
  
  // Get functions in this file
  const functions = currentAnalysis.functions.filter(f => f.file === filePath);
  
  // Get interfaces in this file
  const interfaces = currentAnalysis.interfaces.filter(i => i.file === filePath);
  
  // Get what this file imports
  const imports = currentAnalysis.imports
    .filter(i => i.from === filePath)
    .map(i => ({
      module: i.to,
      items: i.imports,
      isExternal: i.isExternal,
    }));
  
  // Get what imports this file (dependents)
  const importedBy = currentAnalysis.imports
    .filter(i => i.to === filePath || i.to.startsWith(filePath.replace(/\.(ts|tsx)$/, '')))
    .map(i => ({
      file: i.from,
      items: i.imports,
    }));
  
  // Calculate file complexity
  const fileComplexity = functions.reduce((sum, f) => sum + f.complexity, 0);
  const avgComplexity = functions.length > 0 ? Math.round(fileComplexity / functions.length * 10) / 10 : 0;
  
  // Check for issues in this file
  const issues = currentAnalysis.issues.filter(i => i.file === filePath);
  
  // Check if this file is part of any duplicate group
  const duplicates = currentAnalysis.duplicates.filter(d => 
    d.items.some(item => item.file === filePath)
  );
  
  // Generate crux (brief description)
  const crux = generateFileCrux(file, classes, functions, interfaces, imports, importedBy);
  
  // Get all exports (for full list, not "7 more")
  const allExports = [
    ...classes.filter(c => c.exported).map(c => ({ name: c.name, type: 'class', line: c.line })),
    ...functions.filter(f => f.exported).map(f => ({ name: f.name, type: 'function', line: f.line })),
    ...interfaces.filter(i => i.exported).map(i => ({ name: i.name, type: 'interface', line: i.line })),
  ];
  
  res.json({
    success: true,
    file: {
      ...file,
      crux,
      allExports,
      // Contents summary
      classes: classes.map(c => ({
        name: c.name,
        line: c.line,
        methods: c.methods.length,
        properties: c.properties.length,
        extends: c.extends,
        implements: c.implements,
        exported: c.exported,
      })),
      functions: functions.map(f => ({
        name: f.name,
        line: f.line,
        params: f.parameters.length,
        complexity: f.complexity,
        async: f.async,
        exported: f.exported,
      })),
      interfaces: interfaces.map(i => ({
        name: i.name,
        line: i.line,
        properties: i.properties.length,
        exported: i.exported,
      })),
      // Dependencies
      imports,
      importedBy,
      // Metrics
      metrics: {
        totalClasses: classes.length,
        totalFunctions: functions.length,
        totalInterfaces: interfaces.length,
        totalExports: allExports.length,
        complexity: fileComplexity,
        avgComplexity,
        importCount: imports.length,
        dependentCount: importedBy.length,
      },
      // Issues
      issues,
      duplicates,
    },
  });
});

/**
 * Generate crux for a file
 */
function generateFileCrux(
  file: any,
  classes: any[],
  functions: any[],
  interfaces: any[],
  imports: any[],
  importedBy: any[]
): string {
  const parts: string[] = [];
  const name = file.name.toLowerCase();
  const filePath = file.path.toLowerCase();
  
  // 1. Detect pattern type
  let pattern = 'Module';
  if (name.includes('control') && file.extension === '.tsx') pattern = 'PCF Control';
  else if (name.startsWith('use') && functions.length > 0) pattern = 'React Hook';
  else if (name.includes('.hook')) pattern = 'React Hook';
  else if (name.includes('service')) pattern = 'Service';
  else if (name.includes('provider')) pattern = 'Provider';
  else if (name.includes('context')) pattern = 'React Context';
  else if (name.includes('util') || name.includes('helper')) pattern = 'Utility file';
  else if (name.includes('mock') || filePath.includes('/mock') || filePath.includes('/testing')) pattern = 'Test utility';
  else if (file.extension === '.tsx') pattern = 'React Component';
  else if (classes.length > 0) pattern = 'Class module';
  else if (functions.length > 0) pattern = 'Function module';
  
  parts.push(pattern + '.');
  
  // 2. What it exports
  const exportedClasses = classes.filter((c: any) => c.exported);
  const exportedFunctions = functions.filter((f: any) => f.exported);
  const exportCount = exportedClasses.length + exportedFunctions.length + interfaces.filter((i: any) => i.exported).length;
  
  if (exportCount > 0) {
    const mainExports: string[] = [];
    exportedClasses.slice(0, 2).forEach((c: any) => mainExports.push(c.name));
    exportedFunctions.slice(0, 2).forEach((f: any) => mainExports.push(f.name + '()'));
    
    if (mainExports.length > 0) {
      const more = exportCount > mainExports.length ? ` +${exportCount - mainExports.length} more` : '';
      parts.push(`Exports ${mainExports.join(', ')}${more}.`);
    }
  }
  
  // 3. Usage status
  if (importedBy.length === 0) {
    if (filePath.includes('test') || filePath.includes('mock')) {
      parts.push('Used by test files.');
    } else if (pattern.includes('Control')) {
      parts.push('Entry point for framework.');
    } else {
      parts.push('No direct imports found.');
    }
  } else if (importedBy.length >= 10) {
    parts.push(`Core file — ${importedBy.length} dependents.`);
  } else if (importedBy.length >= 5) {
    parts.push(`Widely used — ${importedBy.length} dependents.`);
  } else {
    parts.push(`${importedBy.length} dependent${importedBy.length > 1 ? 's' : ''}.`);
  }
  
  // 4. Key dependencies
  const internalImports = imports.filter((i: any) => !i.isExternal);
  if (internalImports.length > 0 && internalImports.length <= 5) {
    const keyDeps = internalImports.map((i: any) => {
      const parts = i.module.split('/');
      return parts[parts.length - 1].replace(/\.(ts|tsx)$/, '');
    });
    parts.push(`Uses ${keyDeps.join(', ')}.`);
  } else if (internalImports.length > 5) {
    parts.push(`Uses ${internalImports.length} internal modules.`);
  }
  
  return parts.join(' ');
}

/**
 * Get details for a specific element
 */
app.get('/api/element/:type/:name', (req, res) => {
  if (!currentAnalysis) {
    return res.status(404).json({ success: false, error: 'No analysis available' });
  }
  
  const { type, name } = req.params;
  let element: any = null;
  
  switch (type) {
    case 'class':
      element = currentAnalysis.classes.find(c => c.name === name);
      break;
    case 'function':
      element = currentAnalysis.functions.find(f => f.name === name);
      break;
    case 'interface':
      element = currentAnalysis.interfaces.find(i => i.name === name);
      break;
  }
  
  if (!element) {
    return res.status(404).json({ success: false, error: `${type} "${name}" not found` });
  }
  
  // Find what uses this element
  const usedBy = currentAnalysis.imports
    .filter((imp: any) => imp.imports.includes(name))
    .map((imp: any) => imp.from);
  
  // Find what this element uses
  const uses = currentAnalysis.imports
    .filter((imp: any) => imp.from === element.file)
    .map((imp: any) => ({ module: imp.to, imports: imp.imports }));
  
  res.json({
    success: true,
    element,
    usedBy,
    uses,
  });
});

// ============================================================================
// PHASE 1: QUICK WINS (No Git needed)
// ============================================================================

/**
 * Health Score - Single 0-100 score for codebase health
 */
app.get('/api/health-score', (req, res) => {
  if (!currentAnalysis) {
    return res.status(404).json({ success: false, error: 'No analysis available' });
  }
  
  let score = 100;
  const breakdown: Array<{ rule: string; penalty: number; count: number; items?: string[] }> = [];
  
  // Circular dependencies: -5 each
  const circularCount = currentAnalysis.dependencyGraph?.circular?.length || 0;
  if (circularCount > 0) {
    const penalty = Math.min(circularCount * 5, 25); // Cap at 25
    score -= penalty;
    breakdown.push({ 
      rule: 'Circular dependencies', 
      penalty, 
      count: circularCount,
      items: currentAnalysis.dependencyGraph?.circular?.slice(0, 3).map((c: string[]) => c.join(' → '))
    });
  }
  
  // Duplicates: -3 each
  const dupCount = currentAnalysis.duplicates?.length || 0;
  if (dupCount > 0) {
    const penalty = Math.min(dupCount * 3, 15);
    score -= penalty;
    breakdown.push({ 
      rule: 'Duplicate files', 
      penalty, 
      count: dupCount 
    });
  }
  
  // God files (>500 lines): -2 each
  const godFiles = currentAnalysis.files.filter((f: any) => f.lines > 500);
  if (godFiles.length > 0) {
    const penalty = Math.min(godFiles.length * 2, 20);
    score -= penalty;
    breakdown.push({ 
      rule: 'Large files (>500 lines)', 
      penalty, 
      count: godFiles.length,
      items: godFiles.slice(0, 3).map((f: any) => `${f.name} (${f.lines} lines)`)
    });
  }
  
  // High complexity functions (>15): -1 each
  const complexFuncs = currentAnalysis.functions.filter((f: any) => f.complexity > 15);
  if (complexFuncs.length > 0) {
    const penalty = Math.min(complexFuncs.length, 15);
    score -= penalty;
    breakdown.push({ 
      rule: 'High complexity functions (>15)', 
      penalty, 
      count: complexFuncs.length,
      items: complexFuncs.slice(0, 3).map((f: any) => `${f.name} (${f.complexity})`)
    });
  }
  
  // Issues count: -1 per 10 issues
  const issueCount = currentAnalysis.issues?.length || 0;
  if (issueCount > 10) {
    const penalty = Math.min(Math.floor(issueCount / 10), 10);
    score -= penalty;
    breakdown.push({ 
      rule: 'Code issues', 
      penalty, 
      count: issueCount 
    });
  }
  
  // Ensure minimum 0
  score = Math.max(0, score);
  
  // Grade
  let grade = 'A';
  let color = '#3fb950';
  if (score < 60) { grade = 'F'; color = '#f85149'; }
  else if (score < 70) { grade = 'D'; color = '#f85149'; }
  else if (score < 80) { grade = 'C'; color = '#d29922'; }
  else if (score < 90) { grade = 'B'; color = '#d29922'; }
  
  res.json({
    success: true,
    healthScore: {
      score,
      grade,
      color,
      breakdown,
      summary: score >= 80 
        ? 'Healthy codebase! Keep it up.' 
        : score >= 60 
          ? 'Some issues to address. See breakdown.' 
          : 'Needs attention. Review the issues below.'
    }
  });
});

/**
 * Unused Exports - Exports that are never imported
 */
app.get('/api/unused-exports', (req, res) => {
  if (!currentAnalysis) {
    return res.status(404).json({ success: false, error: 'No analysis available' });
  }
  
  // Collect all imported items
  const importedItems = new Set<string>();
  for (const imp of currentAnalysis.imports) {
    if (imp.imports) {
      imp.imports.forEach((item: string) => importedItems.add(item));
    }
  }
  
  const unusedExports: Array<{ file: string; name: string; type: string; line: number }> = [];
  
  // Check classes
  for (const cls of currentAnalysis.classes) {
    if (cls.exported && !importedItems.has(cls.name)) {
      unusedExports.push({ file: cls.file, name: cls.name, type: 'class', line: cls.line });
    }
  }
  
  // Check functions
  for (const func of currentAnalysis.functions) {
    if (func.exported && !importedItems.has(func.name)) {
      unusedExports.push({ file: func.file, name: func.name, type: 'function', line: func.line });
    }
  }
  
  // Check interfaces
  for (const iface of currentAnalysis.interfaces) {
    if (iface.exported && !importedItems.has(iface.name)) {
      unusedExports.push({ file: iface.file, name: iface.name, type: 'interface', line: iface.line });
    }
  }
  
  // Count total exports
  const totalExports = 
    currentAnalysis.classes.filter((c: any) => c.exported).length +
    currentAnalysis.functions.filter((f: any) => f.exported).length +
    currentAnalysis.interfaces.filter((i: any) => i.exported).length;
  
  res.json({
    success: true,
    unusedExports,
    count: unusedExports.length,
    totalExports,
    usedPercent: totalExports > 0 ? Math.round(((totalExports - unusedExports.length) / totalExports) * 100) : 100
  });
});

/**
 * God Files - Files that are too big or do too much
 */
app.get('/api/god-files', (req, res) => {
  if (!currentAnalysis) {
    return res.status(404).json({ success: false, error: 'No analysis available' });
  }
  
  const godFiles: Array<{
    file: string;
    name: string;
    lines: number;
    exports: number;
    functions: number;
    classes: number;
    reasons: string[];
  }> = [];
  
  for (const file of currentAnalysis.files) {
    const reasons: string[] = [];
    
    // Count items in this file
    const fileClasses = currentAnalysis.classes.filter((c: any) => c.file === file.path);
    const fileFunctions = currentAnalysis.functions.filter((f: any) => f.file === file.path);
    const fileExports = [
      ...fileClasses.filter((c: any) => c.exported),
      ...fileFunctions.filter((f: any) => f.exported),
      ...currentAnalysis.interfaces.filter((i: any) => i.file === file.path && i.exported)
    ];
    
    if (file.lines > 500) reasons.push(`${file.lines} lines`);
    if (fileExports.length > 10) reasons.push(`${fileExports.length} exports`);
    if (fileFunctions.length > 20) reasons.push(`${fileFunctions.length} functions`);
    if (fileClasses.length > 3) reasons.push(`${fileClasses.length} classes`);
    
    if (reasons.length > 0) {
      godFiles.push({
        file: file.path,
        name: file.name,
        lines: file.lines,
        exports: fileExports.length,
        functions: fileFunctions.length,
        classes: fileClasses.length,
        reasons
      });
    }
  }
  
  godFiles.sort((a, b) => b.lines - a.lines);
  
  res.json({
    success: true,
    godFiles,
    count: godFiles.length
  });
});

/**
 * Complex Functions - Functions with high cyclomatic complexity
 */
app.get('/api/complex-functions', (req, res) => {
  if (!currentAnalysis) {
    return res.status(404).json({ success: false, error: 'No analysis available' });
  }
  
  const threshold = clampInt(req.query.threshold, 1, 1000, 15);
  
  const complexFunctions = currentAnalysis.functions
    .filter((f: any) => f.complexity > threshold)
    .map((f: any) => ({
      file: f.file,
      fileName: f.file.split('/').pop() || f.file,
      name: f.name,
      complexity: f.complexity,
      line: f.line,
      params: f.parameters?.length || 0,
      async: f.async || false
    }))
    .sort((a: any, b: any) => b.complexity - a.complexity);
  
  res.json({
    success: true,
    complexFunctions,
    count: complexFunctions.length,
    threshold
  });
});

/**
 * Folder Summary - Health metrics per folder
 */
app.get('/api/folder-summary', (req, res) => {
  if (!currentAnalysis) {
    return res.status(404).json({ success: false, error: 'No analysis available' });
  }
  
  const folders = new Map<string, {
    path: string;
    files: number;
    lines: number;
    functions: number;
    classes: number;
    complexity: number;
    issues: number;
  }>();
  
  // Group files by folder
  for (const file of currentAnalysis.files) {
    const parts = file.path.split('/');
    parts.pop(); // Remove filename
    const folderPath = parts.join('/') || '/root';
    
    const existing = folders.get(folderPath) || {
      path: folderPath,
      files: 0,
      lines: 0,
      functions: 0,
      classes: 0,
      complexity: 0,
      issues: 0
    };
    
    existing.files++;
    existing.lines += file.lines;
    folders.set(folderPath, existing);
  }
  
  // Add function/class counts and complexity
  for (const func of currentAnalysis.functions) {
    const parts = func.file.split('/');
    parts.pop();
    const folderPath = parts.join('/') || '/root';
    const folder = folders.get(folderPath);
    if (folder) {
      folder.functions++;
      folder.complexity += func.complexity;
    }
  }
  
  for (const cls of currentAnalysis.classes) {
    const parts = cls.file.split('/');
    parts.pop();
    const folderPath = parts.join('/') || '/root';
    const folder = folders.get(folderPath);
    if (folder) {
      folder.classes++;
    }
  }
  
  // Add issue counts
  for (const issue of currentAnalysis.issues) {
    const parts = issue.file.split('/');
    parts.pop();
    const folderPath = parts.join('/') || '/root';
    const folder = folders.get(folderPath);
    if (folder) {
      folder.issues++;
    }
  }
  
  // Convert to array with averages
  const result = Array.from(folders.values()).map(f => ({
    ...f,
    avgComplexity: f.functions > 0 ? Math.round(f.complexity / f.functions) : 0,
    avgLines: f.files > 0 ? Math.round(f.lines / f.files) : 0
  }));
  
  result.sort((a, b) => b.files - a.files);
  
  res.json({
    success: true,
    folders: result
  });
});

// ============================================================================
// PHASE 2: GIT INSIGHTS
// ============================================================================

/**
 * File Churn - How often each file changes
 */
app.get('/api/git/churn', async (req, res) => {
  if (!currentAnalysis || !currentProject) {
    return res.status(404).json({ success: false, error: 'No analysis available' });
  }
  
  const days = clampInt(req.query.days, 1, 3650, 90);
  const since = new Date();
  since.setDate(since.getDate() - days);
  
  try {
    const git = simpleGit(currentProject.path);
    
    // Check if it's a git repo
    const isRepo = await git.checkIsRepo();
    if (!isRepo) {
      return res.status(400).json({ success: false, error: 'Not a git repository' });
    }
    
    // Get log with numstat for file changes
    const logResult = await git.raw([
      'log',
      `--since=${since.toISOString().split('T')[0]}`,
      '--pretty=format:%H|%ad|%an',
      '--date=short',
      '--name-only'
    ]);
    
    // Parse the log
    const churnMap = new Map<string, { changes: number; authors: Set<string>; lastChanged: string }>();
    
    const lines = logResult.split('\n');
    let currentAuthor = '';
    let currentDate = '';
    
    for (const line of lines) {
      if (line.includes('|')) {
        const parts = line.split('|');
        currentDate = parts[1] || '';
        currentAuthor = parts[2] || '';
      } else if (line.trim() && (line.endsWith('.ts') || line.endsWith('.tsx'))) {
        const filePath = line.trim();
        const existing = churnMap.get(filePath) || { 
          changes: 0, 
          authors: new Set<string>(), 
          lastChanged: '' 
        };
        existing.changes++;
        if (currentAuthor) existing.authors.add(currentAuthor);
        if (!existing.lastChanged || currentDate > existing.lastChanged) {
          existing.lastChanged = currentDate;
        }
        churnMap.set(filePath, existing);
      }
    }
    
    // Convert to array and include author names
    const churn = Array.from(churnMap.entries())
      .map(([file, data]) => ({
        file,
        name: file.split('/').pop() || file,
        changes: data.changes,
        authors: data.authors.size,
        authorNames: Array.from(data.authors).slice(0, 5), // Top 5 author names
        lastChanged: data.lastChanged
      }))
      .sort((a, b) => b.changes - a.changes)
      .slice(0, 50);
    
    res.json({
      success: true,
      days,
      churn,
      totalChanges: churn.reduce((sum, c) => sum + c.changes, 0)
    });
  } catch (error) {
    console.error('Git churn error:', error);
    res.status(500).json({ success: false, error: 'Failed to read git history' });
  }
});

/**
 * Code Ownership - Who knows each file best
 */
app.get('/api/git/ownership', async (req, res) => {
  if (!currentAnalysis || !currentProject) {
    return res.status(404).json({ success: false, error: 'No analysis available' });
  }
  
  try {
    const git = simpleGit(currentProject.path);
    
    const isRepo = await git.checkIsRepo();
    if (!isRepo) {
      return res.status(400).json({ success: false, error: 'Not a git repository' });
    }
    
    // Support time filtering
    const timeFilter = req.query.time as string || 'all';
    const logArgs = ['log', '--pretty=format:%an', '--name-only'];
    
    if (timeFilter === '6months') {
      logArgs.push('--since=6 months ago');
    } else if (timeFilter === '3months') {
      logArgs.push('--since=3 months ago');
    }
    
    const logResult = await git.raw(logArgs);
    
    // Count commits per author per file (within the time filter)
    const ownershipMap = new Map<string, Map<string, number>>();
    
    const lines = logResult.split('\n');
    let currentAuthor = '';
    
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      
      if (!trimmed.includes('/') && !trimmed.includes('.')) {
        currentAuthor = trimmed;
      } else if (trimmed.endsWith('.ts') || trimmed.endsWith('.tsx')) {
        if (!ownershipMap.has(trimmed)) {
          ownershipMap.set(trimmed, new Map());
        }
        const fileOwners = ownershipMap.get(trimmed)!;
        fileOwners.set(currentAuthor, (fileOwners.get(currentAuthor) || 0) + 1);
      }
    }
    
    // Get all files from analysis to find knowledge gaps
    const allFiles = currentAnalysis.files.map(f => f.path);
    const filesWithActivity = new Set(ownershipMap.keys());
    
    // Knowledge gaps: files in codebase but NO commits in the time period
    // (Only relevant when time filter is applied)
    let knowledgeGaps: { file: string; name: string }[] = [];
    if (timeFilter !== 'all') {
      knowledgeGaps = allFiles
        .filter(f => !filesWithActivity.has(f))
        .map(f => ({
          file: f,
          name: f.split('/').pop() || f
        }))
        .slice(0, 50); // Limit to top 50
    }
    
    // Find primary owner (based on commits within time period only)
    const ownership = Array.from(ownershipMap.entries())
      .map(([file, authors]) => {
        const sortedAuthors = Array.from(authors.entries()).sort((a, b) => b[1] - a[1]);
        const totalCommits = sortedAuthors.reduce((sum, [, count]) => sum + count, 0);
        const primary = sortedAuthors[0] || ['Unknown', 0];
        
        // Get all author names for display
        const authorNames = sortedAuthors.map(([name]) => name);
        
        return {
          file,
          name: file.split('/').pop() || file,
          primaryOwner: primary[0],
          ownerCommits: primary[1],
          totalCommits,
          ownershipPercent: Math.round((primary[1] / totalCommits) * 100),
          authorCount: sortedAuthors.length,
          authors: authorNames.slice(0, 5) // Top 5 authors
        };
      })
      .sort((a, b) => b.totalCommits - a.totalCommits)
      .slice(0, 100);
    
    res.json({
      success: true,
      ownership,
      knowledgeGaps,
      timeFilter,
      stats: {
        filesWithActivity: filesWithActivity.size,
        filesWithoutActivity: knowledgeGaps.length,
        totalFiles: allFiles.length
      }
    });
  } catch (error) {
    console.error('Git ownership error:', error);
    res.status(500).json({ success: false, error: 'Failed to read git history' });
  }
});

/**
 * Bus Factor - Files with only 1 author (knowledge risk)
 */
app.get('/api/git/bus-factor', async (req, res) => {
  if (!currentAnalysis || !currentProject) {
    return res.status(404).json({ success: false, error: 'No analysis available' });
  }
  
  try {
    const git = simpleGit(currentProject.path);
    
    const isRepo = await git.checkIsRepo();
    if (!isRepo) {
      return res.status(400).json({ success: false, error: 'Not a git repository' });
    }
    
    // Support time filtering (same as ownership)
    const timeFilter = req.query.time as string || 'all';
    const logArgs = ['log', '--pretty=format:%an', '--name-only'];
    
    if (timeFilter === '6months') {
      logArgs.push('--since=6 months ago');
    } else if (timeFilter === '3months') {
      logArgs.push('--since=3 months ago');
    }
    
    const logResult = await git.raw(logArgs);
    
    const fileAuthors = new Map<string, Set<string>>();
    
    const lines = logResult.split('\n');
    let currentAuthor = '';
    
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      
      if (!trimmed.includes('/') && !trimmed.includes('.')) {
        currentAuthor = trimmed;
      } else if (trimmed.endsWith('.ts') || trimmed.endsWith('.tsx')) {
        if (!fileAuthors.has(trimmed)) {
          fileAuthors.set(trimmed, new Set());
        }
        if (currentAuthor) fileAuthors.get(trimmed)!.add(currentAuthor);
      }
    }
    
    // Find single-author files (within the time period)
    const singleAuthorFiles: Array<{ file: string; name: string; author: string }> = [];
    
    for (const [file, authors] of fileAuthors) {
      if (authors.size === 1) {
        singleAuthorFiles.push({
          file,
          name: file.split('/').pop() || file,
          author: Array.from(authors)[0]
        });
      }
    }
    
    // Group by author
    const byAuthor = new Map<string, string[]>();
    for (const item of singleAuthorFiles) {
      if (!byAuthor.has(item.author)) {
        byAuthor.set(item.author, []);
      }
      byAuthor.get(item.author)!.push(item.file);
    }
    
    const busFactor = Array.from(byAuthor.entries())
      .map(([author, files]) => ({
        author,
        soloFiles: files.length,
        files: files.slice(0, 50) // Return more files for expanded view
      }))
      .sort((a, b) => b.soloFiles - a.soloFiles);
    
    const totalFiles = currentAnalysis.files.length;
    const filesWithActivity = fileAuthors.size;
    
    res.json({
      success: true,
      totalSingleAuthorFiles: singleAuthorFiles.length,
      totalFiles,
      filesWithActivity,
      riskPercent: Math.round((singleAuthorFiles.length / Math.max(filesWithActivity, 1)) * 100),
      busFactor,
      timeFilter
    });
  } catch (error) {
    console.error('Git bus-factor error:', error);
    res.status(500).json({ success: false, error: 'Failed to read git history' });
  }
});

/**
 * Stale Files - Not changed in X months
 */
app.get('/api/git/stale', async (req, res) => {
  if (!currentAnalysis || !currentProject) {
    return res.status(404).json({ success: false, error: 'No analysis available' });
  }
  
  const months = clampInt(req.query.months, 1, 120, 6);
  
  try {
    const git = simpleGit(currentProject.path);
    
    const isRepo = await git.checkIsRepo();
    if (!isRepo) {
      return res.status(400).json({ success: false, error: 'Not a git repository' });
    }
    
    // Get last commit date for all files at once
    const logResult = await git.raw([
      'log',
      '--pretty=format:%ad',
      '--date=short',
      '--name-only'
    ]);
    
    const lastChangedMap = new Map<string, string>();
    const lines = logResult.split('\n');
    let currentDate = '';
    
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      
      if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
        currentDate = trimmed;
      } else if (trimmed.endsWith('.ts') || trimmed.endsWith('.tsx')) {
        // Only set if not already set (first occurrence is most recent)
        if (!lastChangedMap.has(trimmed)) {
          lastChangedMap.set(trimmed, currentDate);
        }
      }
    }
    
    // Find stale files
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - months);
    const cutoffStr = cutoff.toISOString().split('T')[0];
    
    const staleFiles: Array<{ file: string; name: string; lastChanged: string; monthsAgo: number }> = [];
    
    for (const [file, lastChanged] of lastChangedMap) {
      if (lastChanged < cutoffStr) {
        const lastDate = new Date(lastChanged);
        const monthsAgo = Math.floor((Date.now() - lastDate.getTime()) / (1000 * 60 * 60 * 24 * 30));
        staleFiles.push({
          file,
          name: file.split('/').pop() || file,
          lastChanged,
          monthsAgo
        });
      }
    }
    
    staleFiles.sort((a, b) => b.monthsAgo - a.monthsAgo);
    
    res.json({
      success: true,
      months,
      staleFiles: staleFiles.slice(0, 50),
      count: staleFiles.length
    });
  } catch (error) {
    console.error('Git stale error:', error);
    res.status(500).json({ success: false, error: 'Failed to read git history' });
  }
});

// ============================================================================
// PHASE 3: EXPORT
// ============================================================================

/**
 * Export for Power BI
 */
app.get('/api/export/pbi', (req, res) => {
  if (!currentAnalysis || !currentProject) {
    return res.status(404).json({ success: false, error: 'No analysis available' });
  }
  
  // FILES table
  const files = currentAnalysis.files.map((f: any) => ({
    path: f.path,
    name: f.name,
    folder: f.path.substring(0, f.path.lastIndexOf('/')) || '/',
    lines: f.lines,
    extension: f.extension || '.ts'
  }));
  
  // FUNCTIONS table
  const functions = currentAnalysis.functions.map((f: any) => ({
    file: f.file,
    name: f.name,
    complexity: f.complexity,
    params: f.parameters?.length || 0,
    async: f.async || false,
    exported: f.exported || false,
    line: f.line
  }));
  
  // CLASSES table
  const classes = currentAnalysis.classes.map((c: any) => ({
    file: c.file,
    name: c.name,
    methods: c.methods?.length || 0,
    properties: c.properties?.length || 0,
    exported: c.exported || false,
    line: c.line
  }));
  
  // IMPORTS table
  const imports = currentAnalysis.imports.map((i: any) => ({
    from: i.from,
    to: i.to,
    isExternal: i.isExternal || false
  }));
  
  // ISSUES table
  const issues = currentAnalysis.issues.map((i: any) => ({
    file: i.file,
    type: i.type,
    severity: i.severity,
    message: i.message,
    line: i.line || 0
  }));
  
  res.json({
    exportDate: new Date().toISOString(),
    project: currentProject.name,
    projectPath: currentProject.path,
    tables: {
      files,
      functions,
      classes,
      imports,
      issues
    },
    summary: {
      totalFiles: files.length,
      totalFunctions: functions.length,
      totalClasses: classes.length,
      totalImports: imports.length,
      totalIssues: issues.length
    }
  });
});

// ============================================================================
// START
// ============================================================================

// SPA fallback for production (Docker)
if (process.env.NODE_ENV === 'production') {
  const webPath = path.join(__dirname, '../../web/dist');
  app.get('*', (req, res) => {
    res.sendFile(path.join(webPath, 'index.html'));
  });
}

cleanupOldClones();

app.listen(PORT, HOST, () => {
  console.log('');
  console.log('╔═══════════════════════════════════════════════════════════╗');
  console.log('║                                                           ║');
  console.log('║   ████████╗███████╗██╗ ██████╗ ██╗  ██╗████████╗         ║');
  console.log('║   ╚══██╔══╝██╔════╝██║██╔════╝ ██║  ██║╚══██╔══╝         ║');
  console.log('║      ██║   ███████╗██║██║  ███╗███████║   ██║            ║');
  console.log('║      ██║   ╚════██║██║██║   ██║██╔══██║   ██║            ║');
  console.log('║      ██║   ███████║██║╚██████╔╝██║  ██║   ██║            ║');
  console.log('║      ╚═╝   ╚══════╝╚═╝ ╚═════╝ ╚═╝  ╚═╝   ╚═╝            ║');
  console.log('║                                                           ║');
  console.log('╚═══════════════════════════════════════════════════════════╝');
  console.log('');
  const displayHost = HOST === '0.0.0.0' ? 'localhost' : HOST;
  console.log(`🚀 TSight running at http://${displayHost}:${PORT}`);
  if (WORKSPACE_ROOT) {
    console.log(`🔒 Workspace root: ${WORKSPACE_ROOT}`);
  }
  console.log('');
  if (process.env.NODE_ENV === 'production') {
    console.log('Mode: Production (Docker)');
    console.log('');
    console.log('Your code is mounted at /code');
    console.log('Enter /code/YourProject in the UI to analyze');
  } else {
    console.log('Mode: Development');
  }
  console.log('');
});
