import React, { useState, useEffect } from 'react';
import './index.css';

interface AnalysisData {
  project: { path: string; name: string; status: string };
  stats: { totalFiles: number; totalLines: number; totalClasses: number; totalFunctions: number; totalInterfaces: number; avgComplexity: number; issueCount: number; duplicateCount: number };
  languages: Array<{ language: string; name?: string; percentage: number; files?: number; color: string }>;
  mentalModel: { layers: Array<{ name: string; description?: string; folders: string[]; files: string[]; color: string }>; flows: Array<{ from: string; to: string; count: number }>; entryPoints: string[]; coreComponents: string[] };
  issues: Array<{ type: string; severity: string; message: string; file: string; line?: number; suggestion?: string }>;
  duplicates: Array<{ type: string; similarity: number; items: Array<{ file: string; name: string; line: number }> }>;
  files?: Array<{ path: string; name?: string; dependents?: number; dependencies?: number }>;
  complexity?: Array<{ file: string; name: string; complexity: number; line?: number }>;
  externalPackages?: Array<{ name: string; usedBy: number }>;
}

interface FileDetail {
  path: string; name: string; lines: number; crux: string;
  allExports: Array<{ name: string; type: string; line: number }>;
  classes: Array<{ name: string; line: number; methods: number; properties: number; extends?: string; exported: boolean }>;
  functions: Array<{ name: string; line: number; params: number; complexity: number; async: boolean; exported: boolean }>;
  interfaces: Array<{ name: string; line: number; properties: number; exported: boolean }>;
  imports: Array<{ module: string; items: string[]; isExternal: boolean }>;
  importedBy: Array<{ file: string; items: string[] }>;
  metrics: { totalClasses: number; totalFunctions: number; totalInterfaces: number; totalExports: number; complexity: number; avgComplexity: number; importCount: number; dependentCount: number };
  issues: Array<{ type: string; severity: string; message: string }>;
  duplicates: Array<{ type: string; similarity: number }>;
}

interface DependencyInsights {
  coreFiles: Array<{ file: string; name: string; dependentCount: number }>;
  complexFiles: Array<{ file: string; name: string; importCount: number }>;
  isolatedFiles: Array<{ file: string; name: string }>;
  circularDeps: Array<{ cycle: string[] }>;
  hotspots: Array<{
    file: string;
    name: string;
    complexity: number;
    dependents: number;
    riskScore: number;
    riskLevel: 'critical' | 'high' | 'medium';
    functions: Array<{ name: string; complexity: number; line: number }>;
  }>;
}

interface BlastRadius {
  file: string;
  name: string;
  directImpact: number;
  indirectImpact: number;
  totalImpact: number;
  totalFiles: number;
  percentageImpact: number;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  levels: Array<{ level: number; files: Array<{ file: string; name: string }> }>;
  summary: string;
}

interface CodebaseFacts {
  resolution: { internal: number; projectImports: number; unresolved: number; percentResolved: number };
  items: Array<{ rule: string; count: number; items: string[] }>;
}

interface GitChurn {
  file: string;
  name: string;
  changes: number;
  authors: number;
  authorNames?: string[];
  lastChanged: string;
}

interface GitOwnership {
  file: string;
  name: string;
  primaryOwner: string;
  ownerCommits: number;
  totalCommits: number;
  ownershipPercent: number;
  authorCount: number;
  authors?: string[];
}

interface KnowledgeGap {
  file: string;
  name: string;
}

interface BusFactor {
  author: string;
  soloFiles: number;
  files: string[];
}

interface SimilarityCriterion {
  name: string;
  description: string;
  valueA: string;
  valueB: string;
  matched: boolean;
}

interface StructuralTwin {
  functionA: { file: string; name: string; line: number };
  functionB: { file: string; name: string; line: number };
  criteria: SimilarityCriterion[];
  matchedCount: number;
  totalCount: number;
  verdict: 'structural-twin' | 'similar-shape' | 'worth-reviewing';
  summary: string;
}

function App() {
  const [analysis, setAnalysis] = useState<AnalysisData | null>(null);
  const [insights, setInsights] = useState<DependencyInsights | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [analysisTimer, setAnalysisTimer] = useState(0);
  const [activeTab, setActiveTab] = useState<'overview' | 'issues' | 'search' | 'git'>('overview');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [selectedFile, setSelectedFile] = useState<FileDetail | null>(null);
  const [loadingFile, setLoadingFile] = useState(false);
  const [activeInsight, setActiveInsight] = useState<string | null>(null);
  const [blastRadius, setBlastRadius] = useState<BlastRadius | null>(null);
  const [loadingBlast, setLoadingBlast] = useState(false);
  const [showWalkthrough, setShowWalkthrough] = useState(false);
  const [walkthroughStep, setWalkthroughStep] = useState(0);
  
  // Phase 1 & 2 state
  const [facts, setFacts] = useState<CodebaseFacts | null>(null);
  const [gitChurn, setGitChurn] = useState<GitChurn[]>([]);
  const [gitOwnership, setGitOwnership] = useState<GitOwnership[]>([]);
  const [busFactor, setBusFactor] = useState<{ riskPercent: number; totalSingleAuthorFiles: number; busFactor: BusFactor[] } | null>(null);
  const [activeGitTab, setActiveGitTab] = useState<'churn' | 'ownership' | 'bus-factor'>('churn');
  const [gitLoading, setGitLoading] = useState(false);
  const [gitError, setGitError] = useState<string | null>(null);
  const [expandedBusFactorAuthor, setExpandedBusFactorAuthor] = useState<string | null>(null);
  const [ownershipTimeFilter, setOwnershipTimeFilter] = useState<'all' | '6months' | '3months'>('all');
  const [knowledgeGaps, setKnowledgeGaps] = useState<KnowledgeGap[]>([]);
  const [expandedKnowledgeGaps, setExpandedKnowledgeGaps] = useState(false);
  const [godFiles, setGodFiles] = useState<Array<{ file: string; name: string; lines: number; exports: number; functions: number; reasons: string[] }>>([]);
  const [complexFunctions, setComplexFunctions] = useState<Array<{ file: string; name: string; complexity: number; line: number }>>([]);
  const [showComplexFunctions, setShowComplexFunctions] = useState(false);
  const [structuralTwins, setStructuralTwins] = useState<StructuralTwin[]>([]);
  const [selectedTwin, setSelectedTwin] = useState<StructuralTwin | null>(null);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    duplicates: true,
    issues: true,
    sameNameFiles: false,
    structuralTwins: false,
    unused: false
  });
  
  // Timer for analysis progress
  useEffect(() => {
    let interval: NodeJS.Timeout | null = null;
    if (loading) {
      setAnalysisTimer(0);
      interval = setInterval(() => {
        setAnalysisTimer(t => t + 1);
      }, 1000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [loading]);
  
  // Format seconds to MM:SS
  const formatTimer = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };
  
  const toggleSection = (section: string) => {
    setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }));
  };

  const analyzeFolder = async (path: string) => {
    setLoading(true); setError(null);
    try {
      const res = await fetch('/api/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path }) });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      
      // Helper to safely fetch with retry
      const safeFetch = async (url: string, retries = 2): Promise<any> => {
        for (let i = 0; i <= retries; i++) {
          try {
            const response = await fetch(url);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return await response.json();
          } catch (err) {
            if (i === retries) return { success: false };
            await new Promise(r => setTimeout(r, 100 * (i + 1))); // Small delay before retry
          }
        }
        return { success: false };
      };
      
      // Fetch data sequentially with small delays to avoid overwhelming the system
      const overview = await safeFetch('/api/overview');
      if (overview.success) setAnalysis(overview);
      
      const insightsRes = await safeFetch('/api/insights');
      if (insightsRes.success) setInsights(insightsRes.insights);
      
      // Fetch health score
      const healthRes = await safeFetch('/api/health-score');
      if (healthRes.success) setFacts(healthRes.facts);
      
      // Fetch god files
      const godRes = await safeFetch('/api/god-files');
      if (godRes.success) setGodFiles(godRes.godFiles);
      
      // Fetch complex functions
      const complexRes = await safeFetch('/api/complex-functions');
      if (complexRes.success) setComplexFunctions(complexRes.complexFunctions);
      
      // Fetch structural twins (honest similarity detection)
      const twinsRes = await safeFetch('/api/structural-twins');
      if (twinsRes.success) {
        setStructuralTwins(twinsRes.structuralTwins || []);
      }
      
      setShowModal(false);
    } catch (err) { setError((err as Error).message); }
    finally { setLoading(false); }
  };

  const fetchGitData = async () => {
    setGitLoading(true);
    setGitError(null);
    try {
      const [churnRes, ownershipRes, busRes] = await Promise.all([
        fetch('/api/git/churn?days=90').then(r => r.json()).catch(() => ({ success: false })),
        fetch(`/api/git/ownership?time=${ownershipTimeFilter}`).then(r => r.json()).catch(() => ({ success: false })),
        fetch('/api/git/bus-factor').then(r => r.json()).catch(() => ({ success: false }))
      ]);
      
      if (churnRes.success) setGitChurn(churnRes.churn);
      if (ownershipRes.success) {
        setGitOwnership(ownershipRes.ownership);
        setKnowledgeGaps(ownershipRes.knowledgeGaps || []);
      }
      if (busRes.success) setBusFactor({ riskPercent: busRes.riskPercent, totalSingleAuthorFiles: busRes.totalSingleAuthorFiles, busFactor: busRes.busFactor });
      
      if (!churnRes.success && !ownershipRes.success) {
        setGitError('Not a git repository or no git history found');
      }
    } catch (err) {
      setGitError('Failed to load git data');
    }
    finally { setGitLoading(false); }
  };
  
  // Refetch ownership when time filter changes
  const fetchOwnershipWithFilter = async (filter: string) => {
    try {
      const res = await fetch(`/api/git/ownership?time=${filter}`).then(r => r.json()).catch(() => ({ success: false }));
      if (res.success) {
        setGitOwnership(res.ownership);
        setKnowledgeGaps(res.knowledgeGaps || []);
      }
    } catch (err) {
      console.error('Failed to fetch ownership', err);
    }
  };
  
  // Refetch bus factor when time filter changes
  const fetchBusFactorWithFilter = async (filter: string) => {
    try {
      const res = await fetch(`/api/git/bus-factor?time=${filter}`).then(r => r.json()).catch(() => ({ success: false }));
      if (res.success) {
        setBusFactor({ 
          riskPercent: res.riskPercent, 
          totalSingleAuthorFiles: res.totalSingleAuthorFiles, 
          busFactor: res.busFactor 
        });
      }
    } catch (err) {
      console.error('Failed to fetch bus factor', err);
    }
  };
  
  // Fetch both ownership and bus factor when time filter changes
  const handleTimeFilterChange = (filter: 'all' | '6months' | '3months') => {
    setOwnershipTimeFilter(filter);
    fetchOwnershipWithFilter(filter);
    fetchBusFactorWithFilter(filter);
  };

  const exportToPBI = async () => {
    try {
      const res = await fetch('/api/export/pbi');
      const data = await res.json();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `tsight-export-${data.project || 'project'}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Export failed:', err);
    }
  };

  const generateDocumentation = () => {
    if (!analysis) {
      alert('No analysis data available. Please analyze a project first.');
      return;
    }
    
    try {
      const now = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
      const projectName = analysis.project?.name || 'Project';
      const stats = analysis.stats || {};
      const files = analysis.files || [];
      const issues = analysis.issues || [];
      const duplicates = analysis.duplicates || [];
      const languages = analysis.languages || [];
      const complexity = analysis.complexity || [];
      
      // Calculate health indicators
      const avgComplexity = stats.avgComplexity || 0;
      const hotspotCount = complexity.filter(c => c.complexity > 10).length;
      const confirmedIssues = issues.filter(i => i.type !== 'unused-file');
      
      // Get core files (files with 3+ dependents for better coverage)
      const coreFiles = files
        .filter(f => f.dependents && f.dependents > 2)
        .sort((a, b) => (b.dependents || 0) - (a.dependents || 0))
        .slice(0, 10);
      
      // Get hotspots
      const hotspots = complexity
        .filter(c => c.complexity > 10)
        .sort((a, b) => b.complexity - a.complexity)
        .slice(0, 5);
      
      // Primary language
      const primaryLang = languages[0]?.name || languages[0]?.language || 'TypeScript';
      
      // Build the markdown document
      let md = `# 🗺️ ${projectName} — Codebase Map

> Your guide to understanding this codebase  
> Generated by TSight · ${now}

---

## 👋 Quick Orientation

This is a **${primaryLang}** project with **${(stats.totalFiles || 0).toLocaleString()} files** and ~**${((stats.totalLines || 0) / 1000).toFixed(0)}K lines** of code.

`;

      // Health Check - only show metrics we actually have
      const healthMetrics: string[] = [];
      
      if (avgComplexity > 0) {
        const complexityStatus = avgComplexity < 5 ? '✅ Healthy' : avgComplexity < 10 ? '⚠️ Moderate' : '🔴 High';
        healthMetrics.push(`| Complexity | ${complexityStatus} (avg: ${avgComplexity.toFixed(1)}) |`);
      }
      
      if (hotspotCount > 0) {
        healthMetrics.push(`| Hotspots | ⚠️ ${hotspotCount} need attention |`);
      }
      
      if (confirmedIssues.length > 0) {
        healthMetrics.push(`| Issues | 📋 ${confirmedIssues.length} to review |`);
      }
      
      if (duplicates.length > 0) {
        healthMetrics.push(`| Duplicates | ⚠️ ${duplicates.length} groups found |`);
      }
      
      if (busFactor && busFactor.riskPercent > 0) {
        const busStatus = busFactor.riskPercent > 50 ? '🔴 High Risk' : busFactor.riskPercent > 30 ? '⚠️ Moderate' : '✅ Good';
        healthMetrics.push(`| Bus Factor | ${busStatus} (${busFactor.riskPercent}% single-author) |`);
      }
      
      if (healthMetrics.length > 0) {
        md += `### Health Check

| Metric | Status |
|--------|--------|
${healthMetrics.join('\n')}

`;
      }

      md += `---

## 🔄 Architecture Flow

Copy this diagram to any Markdown viewer, GitHub, or [Mermaid Live Editor](https://mermaid.live):

\`\`\`mermaid
graph TD
`;

      // Generate Mermaid diagram from actual code structure
      if (analysis.mentalModel?.layers && analysis.mentalModel.layers.length > 0) {
        const layers = analysis.mentalModel.layers;
        
        // Create subgraphs for each layer
        layers.forEach((layer) => {
          const layerId = layer.name.replace(/[^a-zA-Z0-9]/g, '');
          const icon = layer.name.toLowerCase().includes('ui') || layer.name.toLowerCase().includes('component') ? '🖥️' :
                       layer.name.toLowerCase().includes('service') || layer.name.toLowerCase().includes('logic') ? '⚙️' :
                       layer.name.toLowerCase().includes('data') || layer.name.toLowerCase().includes('api') ? '💾' :
                       layer.name.toLowerCase().includes('util') || layer.name.toLowerCase().includes('helper') ? '🔧' : '📦';
          
          md += `    subgraph ${layerId}["${icon} ${layer.name}"]\n`;
          
          // Add top folders as nodes
          const folders = (layer.folders || []).slice(0, 3);
          folders.forEach(folder => {
            const folderId = folder.replace(/[^a-zA-Z0-9]/g, '');
            const folderName = folder.split('/').pop() || folder;
            md += `        ${folderId}[${folderName}]\n`;
          });
          
          md += `    end\n`;
        });
        
        // Add connections between layers (top to bottom flow)
        for (let i = 0; i < layers.length - 1; i++) {
          const fromLayer = layers[i].name.replace(/[^a-zA-Z0-9]/g, '');
          const toLayer = layers[i + 1].name.replace(/[^a-zA-Z0-9]/g, '');
          md += `    ${fromLayer} --> ${toLayer}\n`;
        }
      } else {
        // Fallback: generate from folder structure
        const folderCounts: Record<string, number> = {};
        files.forEach(f => {
          const parts = f.path.split('/');
          if (parts.length > 1) {
            const topFolder = parts[0];
            folderCounts[topFolder] = (folderCounts[topFolder] || 0) + 1;
          }
        });
        
        const topFolders = Object.entries(folderCounts)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 6)
          .map(([name]) => name);
        
        if (topFolders.length > 0) {
          topFolders.forEach(folder => {
            const folderId = folder.replace(/[^a-zA-Z0-9]/g, '');
            md += `    ${folderId}[${folder}/]\n`;
          });
          
          // Connect in a simple flow
          for (let i = 0; i < topFolders.length - 1; i++) {
            const from = topFolders[i].replace(/[^a-zA-Z0-9]/g, '');
            const to = topFolders[i + 1].replace(/[^a-zA-Z0-9]/g, '');
            md += `    ${from} --> ${to}\n`;
          }
        } else {
          md += `    A[Source Files] --> B[Output]\n`;
        }
      }

      md += `\`\`\`

`;

      // Language breakdown (compact)
      if (languages.length > 0) {
        md += `**Languages:** `;
        md += languages.slice(0, 3).map(l => {
          const langName = l.name || l.language || 'Unknown';
          return `${langName} (${l.percentage}%)`;
        }).join(' · ');
        md += `\n\n`;
      }

      // Core Files - only show if we have them
      if (coreFiles.length > 0) {
        md += `---

## 🎯 Start Here — Core Files

These files are the **foundation** — understand them first:

| File | Why It Matters |
|------|----------------|
`;
        coreFiles.forEach(f => {
          const fileName = f.path.split('/').pop() || f.path;
          md += `| \`${fileName}\` | ${f.dependents} files depend on this |\n`;
        });
        md += `
> 💡 **Pro tip:** Read these files before diving into features.

`;
      }

      // Hotspots - only show if we have them
      if (hotspots.length > 0) {
        md += `---

## 🔥 Hotspots — Handle With Care

These files have **high complexity** — extra caution when modifying:

| File | Function | Risk Level |
|------|----------|------------|
`;
        hotspots.forEach(h => {
          const risk = h.complexity > 20 ? '🔴 Critical' : h.complexity > 15 ? '🟠 High' : '🟡 Medium';
          md += `| \`${h.file.split('/').pop()}\` | \`${h.name}()\` | ${risk} (${h.complexity}) |\n`;
        });
        md += `
> ⚠️ **Before changing these:** Get code review, add tests, consider refactoring.

`;
      }

      // Issues - only show if we have them
      if (duplicates.length > 0 || confirmedIssues.length > 0) {
        md += `---

## ⚠️ Known Issues

`;

        if (duplicates.length > 0) {
          md += `### 📋 Duplicates (${duplicates.length} groups)

These files have identical content — consider consolidating:

`;
          duplicates.slice(0, 3).forEach((dup, i) => {
            md += `**Group ${i + 1}:**\n`;
            (dup.items || []).slice(0, 3).forEach(item => {
              md += `- \`${item.file}\`\n`;
            });
            if ((dup.items || []).length > 3) {
              md += `- _+${dup.items.length - 3} more_\n`;
            }
            md += `\n`;
          });
          if (duplicates.length > 3) {
            md += `_...and ${duplicates.length - 3} more groups_\n\n`;
          }
        }

        if (confirmedIssues.length > 0) {
          md += `### 🚨 Code Issues (${confirmedIssues.length})

`;
          const issuesByType = confirmedIssues.reduce((acc, issue) => {
            acc[issue.type] = (acc[issue.type] || 0) + 1;
            return acc;
          }, {} as Record<string, number>);
          
          Object.entries(issuesByType).forEach(([type, count]) => {
            md += `- **${type}**: ${count} occurrence${count > 1 ? 's' : ''}\n`;
          });
          md += `\n`;
        }
      }

      // Team Knowledge - only show if we have git data
      if (busFactor || gitChurn.length > 0) {
        md += `---

## 👥 Team Knowledge

`;

        if (busFactor && busFactor.riskPercent > 0) {
          const riskEmoji = busFactor.riskPercent > 50 ? '🔴' : busFactor.riskPercent > 30 ? '🟠' : '🟢';
          md += `### Bus Factor: ${riskEmoji} ${busFactor.riskPercent}%

**${busFactor.totalSingleAuthorFiles} files** have only one author — if they leave, knowledge is lost.

`;
          
          if (busFactor.busFactor.length > 0) {
            md += `| Person | Solo Files | Action Needed |
|--------|------------|---------------|
`;
            busFactor.busFactor.slice(0, 5).forEach(b => {
              const action = b.soloFiles > 20 ? 'Urgent: pair programming' : b.soloFiles > 10 ? 'Schedule knowledge transfer' : 'Monitor';
              md += `| ${b.author} | ${b.soloFiles} | ${action} |\n`;
            });
            md += `\n`;
          }
        }

        if (gitChurn.length > 0) {
          md += `### 📈 Most Active Files (Last 90 Days)

| File | Changes | Authors |
|------|---------|--------|
`;
          gitChurn.slice(0, 5).forEach(c => {
            const authors = c.authorNames?.slice(0, 2).join(', ') || `${c.authors} people`;
            md += `| \`${c.file.split('/').pop()}\` | ${c.changes} | ${authors} |\n`;
          });
          md += `\n`;
        }
      }

      // Dependencies - only show if we have them
      if (analysis.externalPackages && analysis.externalPackages.length > 0) {
        md += `---

## 📦 Key Dependencies

| Package | Used In | Purpose |
|---------|---------|--------|
`;
        const topPackages = [...analysis.externalPackages]
          .sort((a, b) => (b.usedBy || 0) - (a.usedBy || 0))
          .slice(0, 8);
        
        topPackages.forEach(pkg => {
          const purpose = pkg.name.includes('react') ? 'UI Framework' :
                          pkg.name.includes('test') || pkg.name.includes('jest') ? 'Testing' :
                          pkg.name.includes('axios') || pkg.name.includes('fetch') ? 'HTTP Client' :
                          pkg.name.includes('lodash') ? 'Utilities' :
                          pkg.name.includes('express') ? 'Server' :
                          pkg.name.includes('typescript') ? 'Type System' :
                          'Library';
          md += `| \`${pkg.name}\` | ${pkg.usedBy || 0} files | ${purpose} |\n`;
        });
        md += `\n`;
      }

      // Getting Productive section
      md += `---

## 🚀 Getting Started

### Your First Week

| Day | Goal |
|-----|------|
| **1** | Read this doc, run the app locally |
| **2** | Explore the core files listed above |
| **3** | Trace one feature end-to-end |
| **4-5** | Pick a small issue, ship it |

### Before Making Changes

1. Check if the file is a **hotspot** — if yes, get review
2. Run the test suite
3. Update documentation if needed

---

> 💡 **This document was auto-generated.** Re-run TSight after major changes to keep it updated.
>
> _Generated by TSight_
`;

      // Download the file
      const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${projectName.toLowerCase().replace(/[^a-z0-9]/g, '-')}-codebase-map.md`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Failed to generate documentation:', err);
      alert('Failed to generate documentation. Check console for details.');
    }
  };

  const handleSearch = async (query: string) => {
    setSearchQuery(query);
    if (!query.trim()) { setSearchResults([]); return; }
    try { const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`); const data = await res.json(); if (data.success) setSearchResults(data.results); }
    catch (err) { console.error('Search failed:', err); }
  };

  const openFileDetail = async (filePath: string) => {
    setLoadingFile(true);
    try { const res = await fetch(`/api/file/${encodeURIComponent(filePath)}`); const data = await res.json(); if (data.success) setSelectedFile(data.file); }
    catch (err) { console.error('Failed to load file:', err); }
    finally { setLoadingFile(false); }
  };

  const fetchBlastRadius = async (filePath: string) => {
    setLoadingBlast(true);
    setBlastRadius(null);
    try {
      const res = await fetch(`/api/blast-radius/${encodeURIComponent(filePath)}`);
      const data = await res.json();
      if (data.success) setBlastRadius(data.blastRadius);
    } catch (err) { console.error('Failed to fetch blast radius:', err); }
    finally { setLoadingBlast(false); }
  };

  const confirmedIssues = analysis?.issues.filter(i => i.type !== 'dead-code') || [];
  const unusedFileIssues = analysis?.issues.filter(i => i.type === 'dead-code') || [];

  return (
    <div className="app">
      <a href="#main-content" className="skip-link">Skip to main content</a>
      
      <header className="header">
        <div className="header-left">
          <div className="header-logo">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" /></svg>
            <span>TSight</span>
          </div>
          {analysis && <div className="header-project"><span className="project-name">{analysis.project.name}</span><span className="project-stats">{analysis.stats.totalFiles.toLocaleString()} files • {analysis.stats.totalLines.toLocaleString()} lines</span></div>}
        </div>
        <div className="header-right">
          {analysis && <button className="btn btn-secondary" onClick={generateDocumentation} title="Download codebase documentation as Markdown">🗺️ Codebase Map</button>}
          {analysis && <button className="btn btn-secondary" onClick={() => { setShowWalkthrough(true); setWalkthroughStep(0); }} title="How to use TSight">❓ Guide</button>}
          <button className="btn btn-primary" onClick={() => setShowModal(true)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
            Analyze
          </button>
        </div>
      </header>

      <main className="main" id="main-content">
        {loading ? (
          <div className="loading-screen" role="status" aria-live="polite">
            <div className="spinner large" aria-hidden="true" />
            <h2>Analyzing codebase...</h2>
            <div style={{ 
              fontSize: '2rem', 
              fontFamily: 'var(--font-mono)', 
              color: 'var(--primary)',
              margin: 'var(--space-md) 0',
              fontWeight: 600
            }}>
              ⏱️ {formatTimer(analysisTimer)}
            </div>
            <p style={{ color: 'var(--text2)' }}>Parsing files, building dependency graph</p>
          </div>
        ) : analysis ? (
          <>
            <nav className="tabs" role="tablist" aria-label="Main navigation">
              <button className={`tab ${activeTab === 'overview' ? 'active' : ''}`} onClick={() => setActiveTab('overview')} role="tab" aria-selected={activeTab === 'overview'}>Overview</button>
              <button className={`tab ${activeTab === 'issues' ? 'active' : ''}`} onClick={() => setActiveTab('issues')} role="tab" aria-selected={activeTab === 'issues'}>Issues{(confirmedIssues.length + analysis.duplicates.length) > 0 && <span className="tab-badge">{confirmedIssues.length + analysis.duplicates.length}</span>}</button>
              <button className={`tab ${activeTab === 'git' ? 'active' : ''}`} onClick={() => { setActiveTab('git'); if (gitChurn.length === 0 && !gitLoading) fetchGitData(); }} role="tab" aria-selected={activeTab === 'git'}>Git Insights</button>
              <button className={`tab ${activeTab === 'search' ? 'active' : ''}`} onClick={() => setActiveTab('search')} role="tab" aria-selected={activeTab === 'search'}>Search</button>
              <button className="tab" onClick={exportToPBI} style={{ marginLeft: 'auto' }}>📤 Export PBI</button>
            </nav>

            <div className="content-area" role="tabpanel">
              {activeTab === 'overview' && (
                <>
                  {facts && (
                    <div className="health-score-banner" style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 'var(--space-md)', marginBottom: 'var(--space-lg)' }}>
                      <div style={{ fontWeight: 600, marginBottom: 'var(--space-xs)' }}>
                        Resolved {facts.resolution.internal.toLocaleString()} of {facts.resolution.projectImports.toLocaleString()} project imports ({facts.resolution.percentResolved}%)
                      </div>
                      <div style={{ color: 'var(--text2)', marginBottom: 'var(--space-sm)', fontSize: '0.875rem' }}>
                        {facts.resolution.unresolved === 0
                          ? 'Every import of project code was matched to a file, so the numbers below cover the whole graph.'
                          : `${facts.resolution.unresolved} imports point at project code that could not be found. Numbers that depend on imports may be missing those links.`}
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                        {facts.items.map((b) => (
                          <button
                            key={b.rule}
                            onClick={() => {
                              if (b.rule.includes('cycle')) setActiveInsight('circular');
                              else if (b.rule.includes('Duplicate')) setActiveTab('issues');
                              else if (b.rule.includes('500 lines')) setActiveInsight('god-files');
                              else if (b.rule.includes('complexity')) setShowComplexFunctions(true);
                            }}
                            className="health-breakdown-item"
                            title={b.items.join('\n')}
                            style={{ fontSize: '0.75rem', background: 'var(--bg)', padding: '6px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text)' }}
                          >
                            <span style={{ fontWeight: 600 }}>{b.count}</span>
                            <span>{b.rule}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="stats-row">
                    <div className="stat-card"><span className="stat-icon" aria-hidden="true">📄</span><span className="stat-value">{analysis.stats.totalFiles.toLocaleString()}</span><span className="stat-label">Files</span></div>
                    <div className="stat-card"><span className="stat-icon" aria-hidden="true">📝</span><span className="stat-value">{analysis.stats.totalLines.toLocaleString()}</span><span className="stat-label">Lines</span></div>
                    <div className="stat-card"><span className="stat-icon" aria-hidden="true">🔷</span><span className="stat-value">{analysis.stats.totalClasses}</span><span className="stat-label">Classes</span></div>
                    <div className="stat-card"><span className="stat-icon" aria-hidden="true">ƒ</span><span className="stat-value">{analysis.stats.totalFunctions}</span><span className="stat-label">Functions</span></div>
                    <div className="stat-card"><span className="stat-icon" aria-hidden="true">📊</span><span className={`stat-value ${analysis.stats.avgComplexity > 10 ? 'warning' : ''}`}>{analysis.stats.avgComplexity}</span><span className="stat-label">Complexity</span></div>
                    <div className="stat-card"><span className="stat-icon" aria-hidden="true">📋</span><span className={`stat-value ${analysis.duplicates.length > 0 ? 'warning' : 'success'}`}>{analysis.duplicates.length}</span><span className="stat-label">Duplicates</span></div>
                  </div>

                  <div className="card"><div className="card-header">📊 Languages</div><div className="card-body"><LanguageBar languages={analysis.languages} /></div></div>

                  {/* Dependency Insights */}
                  {insights && (
                    <div className="card">
                      <div className="card-header">🔗 Dependency Insights</div>
                      <div className="card-body">
                        <p className="hint">Click a card to see the files. Every number is real — from actual import statements.</p>
                        <div className="insights-grid">
                          <InsightCard icon="🎯" count={insights.coreFiles.length} label="Core Files" desc="Imported by 5+ files" active={activeInsight === 'core'} onClick={() => setActiveInsight(activeInsight === 'core' ? null : 'core')} />
                          <InsightCard icon="🔥" count={insights.hotspots.length} label="Hotspots" desc="Complex + many dependents" active={activeInsight === 'hotspots'} onClick={() => setActiveInsight(activeInsight === 'hotspots' ? null : 'hotspots')} warning={insights.hotspots.some(h => h.riskLevel === 'critical')} />
                          <InsightCard icon="🏝️" count={insights.isolatedFiles.length} label="Isolated Files" desc="No internal deps" active={activeInsight === 'isolated'} onClick={() => setActiveInsight(activeInsight === 'isolated' ? null : 'isolated')} />
                          <InsightCard icon="🔄" count={insights.circularDeps.length} label="Circular Deps" desc="Import cycles" active={activeInsight === 'circular'} onClick={() => setActiveInsight(activeInsight === 'circular' ? null : 'circular')} warning={insights.circularDeps.length > 0} />
                          <InsightCard icon="📦" count={godFiles.length} label="Large Files" desc=">500 lines or >10 exports" active={activeInsight === 'god-files'} onClick={() => setActiveInsight(activeInsight === 'god-files' ? null : 'god-files')} warning={godFiles.length > 10} />
                        </div>
                        
                        {activeInsight && (
                          <InsightDetails type={activeInsight} insights={insights} godFiles={godFiles} onFileClick={openFileDetail} onClose={() => setActiveInsight(null)} onBlastRadius={fetchBlastRadius} />
                        )}
                      </div>
                    </div>
                  )}

                  {/* Duplicates */}
                  {analysis.duplicates.length > 0 && (
                    <div className="card card-warning"><div className="card-header">⚠️ Duplicate Files<span className="badge">{analysis.duplicates.length}</span></div><div className="card-body">
                      <p className="hint">Files with 100% identical content — should be consolidated</p>
                      {analysis.duplicates.slice(0, 5).map((dup, i) => <div key={i} className="duplicate-group">{dup.items.map((item, j) => <div key={j} className="duplicate-file" onClick={() => openFileDetail(item.file)}><span className="icon" aria-hidden="true">📄</span><div className="info"><span className="name">{item.name}</span><span className="path">{item.file}</span></div></div>)}</div>)}
                    </div></div>
                  )}
                </>
              )}

              {activeTab === 'issues' && (
                <div className="issues-page">
                  {/* Summary Header */}
                  <div className="issues-header" style={{ marginBottom: 'var(--space-lg)' }}>
                    <div style={{ fontSize: '0.875rem', color: 'var(--text2)' }}>
                      {analysis.duplicates.length + confirmedIssues.length} confirmed · {structuralTwins.length + unusedFileIssues.length} to review
                    </div>
                  </div>

                  {/* CERTAIN: Exact Duplicates */}
                  <div className="accordion-section" style={{ marginBottom: 'var(--space-sm)' }}>
                    <button 
                      className="accordion-header"
                      onClick={() => toggleSection('duplicates')}
                      style={{
                        width: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 'var(--space-sm)',
                        padding: 'var(--space-md)',
                        background: 'var(--bg2)',
                        border: '1px solid var(--border)',
                        borderRadius: expandedSections.duplicates ? 'var(--radius) var(--radius) 0 0' : 'var(--radius)',
                        cursor: 'pointer',
                        textAlign: 'left',
                        color: 'var(--text)',
                        fontFamily: 'inherit',
                        fontSize: '0.9375rem'
                      }}
                    >
                      <span style={{ color: 'var(--text3)' }}>{expandedSections.duplicates ? '▼' : '▶'}</span>
                      <span>📋</span>
                      <span style={{ fontWeight: 600 }}>Exact Duplicates</span>
                      <span className="badge">{analysis.duplicates.length}</span>
                      <span style={{
                        marginLeft: 'auto',
                        background: 'var(--success-soft)',
                        color: 'var(--success)',
                        padding: '2px 8px',
                        borderRadius: '4px',
                        fontSize: '0.6875rem',
                        fontWeight: 600
                      }}>Certain</span>
                    </button>
                    {!expandedSections.duplicates && (
                      <div style={{ 
                        padding: '0 var(--space-md) var(--space-sm)', 
                        background: 'var(--bg2)',
                        borderLeft: '1px solid var(--border)',
                        borderRight: '1px solid var(--border)',
                        borderBottom: '1px solid var(--border)',
                        borderRadius: '0 0 var(--radius) var(--radius)',
                        fontSize: '0.8125rem',
                        color: 'var(--text3)'
                      }}>
                        100% identical files — safe to consolidate
                      </div>
                    )}
                    {expandedSections.duplicates && (
                      <div style={{
                        padding: 'var(--space-md)',
                        background: 'var(--bg)',
                        border: '1px solid var(--border)',
                        borderTop: 'none',
                        borderRadius: '0 0 var(--radius) var(--radius)'
                      }}>
                        <p className="hint" style={{ marginBottom: 'var(--space-md)' }}>100% identical files — safe to consolidate</p>
                        {analysis.duplicates.length === 0 ? (
                          <div style={{ color: 'var(--text3)', textAlign: 'center', padding: 'var(--space-md)' }}>✓ No duplicates found</div>
                        ) : (
                          analysis.duplicates.map((dup, i) => (
                            <div key={i} className="duplicate-group" style={{ marginBottom: 'var(--space-sm)' }}>
                              {dup.items.map((item, j) => (
                                <div key={j} className="duplicate-file" onClick={() => openFileDetail(item.file)}>
                                  <span className="icon">📄</span>
                                  <div className="info">
                                    <span className="name">{item.name}</span>
                                    <span className="path">{item.file}</span>
                                  </div>
                                  <span style={{ color: 'var(--text3)' }}>→</span>
                                </div>
                              ))}
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </div>

                  {/* CERTAIN: Code Issues */}
                  <div className="accordion-section" style={{ marginBottom: 'var(--space-sm)' }}>
                    <button 
                      className="accordion-header"
                      onClick={() => toggleSection('issues')}
                      style={{
                        width: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 'var(--space-sm)',
                        padding: 'var(--space-md)',
                        background: 'var(--bg2)',
                        border: '1px solid var(--border)',
                        borderRadius: expandedSections.issues ? 'var(--radius) var(--radius) 0 0' : 'var(--radius)',
                        cursor: 'pointer',
                        textAlign: 'left',
                        color: 'var(--text)',
                        fontFamily: 'inherit',
                        fontSize: '0.9375rem'
                      }}
                    >
                      <span style={{ color: 'var(--text3)' }}>{expandedSections.issues ? '▼' : '▶'}</span>
                      <span>⚠️</span>
                      <span style={{ fontWeight: 600 }}>Code Issues</span>
                      <span className="badge">{confirmedIssues.length}</span>
                      <span style={{
                        marginLeft: 'auto',
                        background: 'var(--success-soft)',
                        color: 'var(--success)',
                        padding: '2px 8px',
                        borderRadius: '4px',
                        fontSize: '0.6875rem',
                        fontWeight: 600
                      }}>Certain</span>
                    </button>
                    {!expandedSections.issues && (
                      <div style={{ 
                        padding: '0 var(--space-md) var(--space-sm)', 
                        background: 'var(--bg2)',
                        borderLeft: '1px solid var(--border)',
                        borderRight: '1px solid var(--border)',
                        borderBottom: '1px solid var(--border)',
                        borderRadius: '0 0 var(--radius) var(--radius)',
                        fontSize: '0.8125rem',
                        color: 'var(--text3)'
                      }}>
                        Circular dependencies, high complexity
                      </div>
                    )}
                    {expandedSections.issues && (
                      <div style={{
                        padding: 'var(--space-md)',
                        background: 'var(--bg)',
                        border: '1px solid var(--border)',
                        borderTop: 'none',
                        borderRadius: '0 0 var(--radius) var(--radius)'
                      }}>
                        <p className="hint" style={{ marginBottom: 'var(--space-md)' }}>Circular dependencies, high complexity</p>
                        {confirmedIssues.length === 0 ? (
                          <div style={{ color: 'var(--success)', textAlign: 'center', padding: 'var(--space-md)' }}>✓ No issues found</div>
                        ) : (
                          <ul className="issues-list">
                            {confirmedIssues.slice(0, 20).map((issue, i) => (
                              <li key={i} className="issue-item" onClick={() => openFileDetail(issue.file)}>
                                <div className={`severity ${issue.severity}`}>{issue.severity === 'error' ? '!' : 'i'}</div>
                                <div className="content">
                                  <div className="message">{issue.message}</div>
                                  <div className="file">{issue.file}</div>
                                </div>
                                <span className="arrow">→</span>
                              </li>
                            ))}
                          </ul>
                        )}
                        {confirmedIssues.length > 20 && (
                          <p className="hint" style={{ textAlign: 'center' }}>Showing 20 of {confirmedIssues.length}</p>
                        )}
                      </div>
                    )}
                  </div>

                  {/* MAYBE: Structural Twins */}
                  <div className="accordion-section" style={{ marginBottom: 'var(--space-sm)' }}>
                    <button 
                      className="accordion-header"
                      onClick={() => toggleSection('structuralTwins')}
                      style={{
                        width: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 'var(--space-sm)',
                        padding: 'var(--space-md)',
                        background: 'var(--bg2)',
                        border: '1px solid var(--border)',
                        borderRadius: expandedSections.structuralTwins ? 'var(--radius) var(--radius) 0 0' : 'var(--radius)',
                        cursor: 'pointer',
                        textAlign: 'left',
                        color: 'var(--text)',
                        fontFamily: 'inherit',
                        fontSize: '0.9375rem'
                      }}
                    >
                      <span style={{ color: 'var(--text3)' }}>{expandedSections.structuralTwins ? '▼' : '▶'}</span>
                      <span>🔍</span>
                      <span style={{ fontWeight: 600 }}>Structural Twins</span>
                      <span className="badge">{structuralTwins.length}</span>
                      <span style={{
                        marginLeft: 'auto',
                        background: 'var(--warning-soft)',
                        color: 'var(--warning)',
                        padding: '2px 8px',
                        borderRadius: '4px',
                        fontSize: '0.6875rem',
                        fontWeight: 600
                      }}>Maybe</span>
                    </button>
                    {!expandedSections.structuralTwins && (
                      <div style={{ 
                        padding: '0 var(--space-md) var(--space-sm)', 
                        background: 'var(--bg2)',
                        borderLeft: '1px solid var(--border)',
                        borderRight: '1px solid var(--border)',
                        borderBottom: '1px solid var(--border)',
                        borderRadius: '0 0 var(--radius) var(--radius)',
                        fontSize: '0.8125rem',
                        color: 'var(--text3)'
                      }}>
                        Similar shape, possibly different purpose
                      </div>
                    )}
                    {expandedSections.structuralTwins && (
                      <div style={{
                        padding: 'var(--space-md)',
                        background: 'var(--bg)',
                        border: '1px solid var(--border)',
                        borderTop: 'none',
                        borderRadius: '0 0 var(--radius) var(--radius)'
                      }}>
                        <p className="hint" style={{ marginBottom: 'var(--space-md)' }}>
                          Similar shape, possibly different purpose — review before consolidating
                        </p>
                        {structuralTwins.length === 0 ? (
                          <div style={{ color: 'var(--text3)', textAlign: 'center', padding: 'var(--space-md)' }}>No structural twins found</div>
                        ) : (
                          <>
                            {/* Group twins by folder */}
                            {(() => {
                              const grouped = structuralTwins.reduce((acc, twin) => {
                                const folder = twin.functionA.file.split('/').slice(0, -1).join('/') || '(root)';
                                if (!acc[folder]) acc[folder] = [];
                                acc[folder].push(twin);
                                return acc;
                              }, {} as Record<string, typeof structuralTwins>);
                              
                              return Object.entries(grouped).map(([folder, twins]) => (
                                <div key={folder} style={{ marginBottom: 'var(--space-md)' }}>
                                  <div style={{ 
                                    display: 'flex', 
                                    alignItems: 'center', 
                                    gap: 'var(--space-sm)',
                                    marginBottom: 'var(--space-xs)',
                                    color: 'var(--text2)',
                                    fontSize: '0.8125rem',
                                    fontWeight: 500
                                  }}>
                                    <span>📁</span>
                                    <span style={{ fontFamily: 'var(--font-mono)' }}>{folder}/</span>
                                  </div>
                                  <div style={{ 
                                    marginLeft: 'var(--space-lg)', 
                                    borderLeft: '1px solid var(--border)',
                                    paddingLeft: 'var(--space-md)'
                                  }}>
                                    {twins.map((twin, i) => (
                                      <div
                                        key={i}
                                        onClick={() => setSelectedTwin(twin)}
                                        className="twin-row"
                                        style={{
                                          display: 'flex',
                                          alignItems: 'center',
                                          gap: 'var(--space-sm)',
                                          padding: 'var(--space-xs) var(--space-sm)',
                                          marginBottom: '2px',
                                          borderRadius: 'var(--radius-sm)',
                                          cursor: 'pointer',
                                          fontSize: '0.875rem'
                                        }}
                                      >
                                        <span style={{ color: 'var(--text3)' }}>├──</span>
                                        <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text)' }}>
                                          {twin.functionA.name}()
                                        </span>
                                        <span style={{ color: 'var(--text3)' }}>↔</span>
                                        <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text)' }}>
                                          {twin.functionB.name}()
                                        </span>
                                        <span style={{
                                          marginLeft: 'auto',
                                          background: twin.matchedCount >= 7 ? 'var(--success-soft)' : 'var(--warning-soft)',
                                          color: twin.matchedCount >= 7 ? 'var(--success)' : 'var(--warning)',
                                          padding: '1px 6px',
                                          borderRadius: '4px',
                                          fontSize: '0.6875rem',
                                          fontWeight: 600
                                        }}>
                                          {twin.matchedCount}/{twin.totalCount}
                                        </span>
                                        <span style={{ color: 'var(--text3)' }}>→</span>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              ));
                            })()}
                          </>
                        )}
                      </div>
                    )}
                  </div>

                  {/* MAYBE: Potentially Unused */}
                  <div className="accordion-section" style={{ marginBottom: 'var(--space-sm)' }}>
                    <button 
                      className="accordion-header"
                      onClick={() => toggleSection('unused')}
                      style={{
                        width: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 'var(--space-sm)',
                        padding: 'var(--space-md)',
                        background: 'var(--bg2)',
                        border: '1px solid var(--border)',
                        borderRadius: expandedSections.unused ? 'var(--radius) var(--radius) 0 0' : 'var(--radius)',
                        cursor: 'pointer',
                        textAlign: 'left',
                        color: 'var(--text)',
                        fontFamily: 'inherit',
                        fontSize: '0.9375rem'
                      }}
                    >
                      <span style={{ color: 'var(--text3)' }}>{expandedSections.unused ? '▼' : '▶'}</span>
                      <span>❓</span>
                      <span style={{ fontWeight: 600 }}>Potentially Unused</span>
                      <span className="badge">{unusedFileIssues.length}</span>
                      <span style={{
                        marginLeft: 'auto',
                        background: 'var(--warning-soft)',
                        color: 'var(--warning)',
                        padding: '2px 8px',
                        borderRadius: '4px',
                        fontSize: '0.6875rem',
                        fontWeight: 600
                      }}>Maybe</span>
                    </button>
                    {!expandedSections.unused && (
                      <div style={{ 
                        padding: '0 var(--space-md) var(--space-sm)', 
                        background: 'var(--bg2)',
                        borderLeft: '1px solid var(--border)',
                        borderRight: '1px solid var(--border)',
                        borderBottom: '1px solid var(--border)',
                        borderRadius: '0 0 var(--radius) var(--radius)',
                        fontSize: '0.8125rem',
                        color: 'var(--text3)'
                      }}>
                        No imports found — may be entry points or tests
                      </div>
                    )}
                    {expandedSections.unused && (
                      <div style={{
                        padding: 'var(--space-md)',
                        background: 'var(--bg)',
                        border: '1px solid var(--border)',
                        borderTop: 'none',
                        borderRadius: '0 0 var(--radius) var(--radius)'
                      }}>
                        <p className="hint" style={{ marginBottom: 'var(--space-md)' }}>
                          No imports found — may be entry points, tests, or dynamically loaded
                        </p>
                        {unusedFileIssues.length === 0 ? (
                          <div style={{ color: 'var(--success)', textAlign: 'center', padding: 'var(--space-md)' }}>✓ All files are imported somewhere</div>
                        ) : (
                          <ul className="issues-list">
                            {unusedFileIssues.slice(0, 20).map((issue, i) => (
                              <li key={i} className="issue-item" onClick={() => openFileDetail(issue.file)}>
                                <div className="severity info">?</div>
                                <div className="content">
                                  <div className="message">{issue.message}</div>
                                  <div className="file">{issue.file}</div>
                                </div>
                                <span className="arrow">→</span>
                              </li>
                            ))}
                          </ul>
                        )}
                        {unusedFileIssues.length > 20 && (
                          <p className="hint" style={{ textAlign: 'center' }}>Showing 20 of {unusedFileIssues.length}</p>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {activeTab === 'search' && (
                <div className="search-page">
                  <div className="search-box">
                    <svg className="search-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" /></svg>
                    <input type="text" className="search-input" placeholder="Search classes, functions, files..." value={searchQuery} onChange={(e) => handleSearch(e.target.value)} autoFocus aria-label="Search codebase" />
                    {searchQuery && <button className="clear" onClick={() => { setSearchQuery(''); setSearchResults([]); }} aria-label="Clear search">×</button>}
                  </div>
                  {searchResults.length > 0 ? (
                    <div className="search-results"><p className="results-count">{searchResults.length} results</p>{searchResults.map((r, i) => <div key={i} className="search-result" onClick={() => openFileDetail(r.file || r.path)}><span className={`type type-${r.resultType || r.type}`}>{r.resultType || r.type}</span><div className="info"><span className="name">{r.name}</span><span className="path">{r.file || r.path}</span></div><span className="arrow" aria-hidden="true">→</span></div>)}</div>
                  ) : searchQuery ? <p className="no-results">No results for "{searchQuery}"</p> : <div className="search-hints"><p>Try searching for:</p><div className="chips">{['Service', 'Context', 'Control', 'Utils'].map(h => <button key={h} className="chip" onClick={() => handleSearch(h)}>{h}</button>)}</div></div>}
                </div>
              )}

              {activeTab === 'git' && (
                <div className="git-page">
                  <div className="card">
                    <div className="card-header">
                      📊 Git History Insights
                      <span className="hint" style={{ marginLeft: 'auto', fontWeight: 'normal' }}>Data from local .git folder</span>
                    </div>
                    <div className="card-body">
                      {gitLoading ? (
                        <div className="panel-loading"><div className="spinner" />Loading git history...</div>
                      ) : gitError ? (
                        <div className="empty-state">
                          <span className="icon">⚠️</span>
                          <h3>Git Data Unavailable</h3>
                          <p>{gitError}</p>
                        </div>
                      ) : (
                        <>
                          {/* Shared Time Filter - affects Ownership & Bus Factor */}
                          <div style={{ 
                            display: 'flex', 
                            alignItems: 'center', 
                            gap: 'var(--space-sm)',
                            marginBottom: 'var(--space-md)',
                            padding: 'var(--space-sm) var(--space-md)',
                            background: 'var(--bg3)',
                            borderRadius: 'var(--radius)',
                            flexWrap: 'wrap'
                          }}>
                            <span style={{ fontSize: '0.875rem', color: 'var(--text2)' }}>Time period:</span>
                            <div style={{ display: 'flex', gap: '4px' }}>
                              {[
                                { key: 'all', label: 'All Time' },
                                { key: '6months', label: 'Last 6 mo' },
                                { key: '3months', label: 'Last 3 mo' }
                              ].map(opt => (
                                <button
                                  key={opt.key}
                                  onClick={() => handleTimeFilterChange(opt.key as any)}
                                  style={{
                                    padding: '4px 12px',
                                    fontSize: '0.8125rem',
                                    background: ownershipTimeFilter === opt.key ? 'var(--primary)' : 'transparent',
                                    color: ownershipTimeFilter === opt.key ? '#fff' : 'var(--text2)',
                                    border: 'none',
                                    borderRadius: 'var(--radius-sm)',
                                    cursor: 'pointer',
                                    fontFamily: 'inherit',
                                    transition: 'all 0.15s'
                                  }}
                                >
                                  {opt.label}
                                </button>
                              ))}
                            </div>
                            <span style={{ fontSize: '0.75rem', color: 'var(--text3)', marginLeft: 'auto' }}>
                              Affects Ownership & Bus Factor
                            </span>
                          </div>
                          
                          <div className="git-tabs">
                            <button className={`git-tab ${activeGitTab === 'churn' ? 'active' : ''}`} onClick={() => setActiveGitTab('churn')}>
                              📈 Churn
                            </button>
                            <button className={`git-tab ${activeGitTab === 'ownership' ? 'active' : ''}`} onClick={() => setActiveGitTab('ownership')}>
                              👥 Ownership {knowledgeGaps.length > 0 && ownershipTimeFilter !== 'all' && <span className="badge" style={{ background: 'var(--danger)' }}>{knowledgeGaps.length}</span>}
                            </button>
                            <button className={`git-tab ${activeGitTab === 'bus-factor' ? 'active' : ''}`} onClick={() => setActiveGitTab('bus-factor')}>
                              🚌 Bus Factor {busFactor && busFactor.riskPercent > 30 && <span className="badge" style={{ background: 'var(--danger)' }}>{busFactor.riskPercent}%</span>}
                            </button>
                          </div>

                          {/* FILE CHURN TAB */}
                          {activeGitTab === 'churn' && (
                            <div className="git-content">
                              <p className="hint">Files changed most frequently in the last 90 days</p>
                              {gitChurn.length === 0 ? (
                                <p className="empty-hint">No file changes found in the last 90 days</p>
                              ) : (
                                <ul className="file-list" style={{ margin: 0, padding: 0 }}>
                                  {gitChurn.slice(0, 20).map((c, i) => (
                                    <li 
                                      key={i} 
                                      onClick={() => openFileDetail(c.file)} 
                                      style={{ 
                                        display: 'flex',
                                        flexDirection: 'column',
                                        padding: 'var(--space-sm) var(--space-md)',
                                        background: 'var(--bg2)',
                                        border: '1px solid var(--border)',
                                        borderRadius: 'var(--radius-sm)',
                                        marginBottom: 'var(--space-xs)',
                                        cursor: 'pointer',
                                        transition: 'background 0.15s'
                                      }}
                                      className="twin-row"
                                    >
                                      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
                                        <span style={{ color: 'var(--text3)', fontSize: '0.75rem', minWidth: '24px' }}>#{i + 1}</span>
                                        <span style={{ fontWeight: 500 }}>{c.name}</span>
                                        <span style={{ marginLeft: 'auto', color: 'var(--text3)' }}>→</span>
                                      </div>
                                      <div style={{ 
                                        fontSize: '0.8125rem', 
                                        color: 'var(--text2)', 
                                        marginTop: '4px',
                                        marginLeft: '32px'
                                      }}>
                                        {c.changes} changes · by {c.authorNames && c.authorNames.length > 0 
                                          ? c.authorNames.slice(0, 2).join(', ') + (c.authors > 2 ? ` +${c.authors - 2}` : '')
                                          : `${c.authors} people`} · {c.lastChanged}
                                      </div>
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </div>
                          )}

                          {/* OWNERSHIP TAB */}
                          {activeGitTab === 'ownership' && (
                            <div className="git-content">
                              {/* Knowledge Gaps - Only show when time filter is applied */}
                              {ownershipTimeFilter !== 'all' && knowledgeGaps.length > 0 && (
                                <div style={{ 
                                  background: 'rgba(248, 81, 73, 0.1)', 
                                  border: '1px solid var(--danger)',
                                  borderRadius: 'var(--radius)',
                                  marginBottom: 'var(--space-md)',
                                  overflow: 'hidden'
                                }}>
                                  <div style={{ padding: 'var(--space-md)' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', marginBottom: 'var(--space-sm)' }}>
                                      <span style={{ fontSize: '1.25rem' }}>🚨</span>
                                      <span style={{ fontWeight: 600, color: 'var(--danger)' }}>Knowledge Gaps</span>
                                      <span className="badge" style={{ background: 'var(--danger)', color: '#fff' }}>{knowledgeGaps.length}</span>
                                    </div>
                                    <p style={{ fontSize: '0.8125rem', color: 'var(--text2)', margin: '0 0 var(--space-sm) 0' }}>
                                      These files have <strong>zero commits</strong> in the selected period — no one has touched them recently.
                                    </p>
                                    
                                    {/* Collapsed view: show first 10 + clickable expand */}
                                    {!expandedKnowledgeGaps && (
                                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-xs)' }}>
                                        {knowledgeGaps.slice(0, 10).map((g, i) => (
                                          <button
                                            key={i}
                                            onClick={() => openFileDetail(g.file)}
                                            style={{
                                              padding: '4px 10px',
                                              fontSize: '0.75rem',
                                              background: 'var(--bg)',
                                              border: '1px solid var(--border)',
                                              borderRadius: 'var(--radius-sm)',
                                              cursor: 'pointer',
                                              fontFamily: 'var(--font-mono)',
                                              color: 'var(--text)'
                                            }}
                                          >
                                            {g.name}
                                          </button>
                                        ))}
                                        {knowledgeGaps.length > 10 && (
                                          <button
                                            onClick={() => setExpandedKnowledgeGaps(true)}
                                            style={{ 
                                              fontSize: '0.75rem', 
                                              color: 'var(--primary)', 
                                              padding: '4px 10px',
                                              background: 'var(--bg)',
                                              border: '1px solid var(--primary)',
                                              borderRadius: 'var(--radius-sm)',
                                              cursor: 'pointer',
                                              fontWeight: 500
                                            }}
                                          >
                                            +{knowledgeGaps.length - 10} more →
                                          </button>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                  
                                  {/* Expanded view: folder structure */}
                                  {expandedKnowledgeGaps && (
                                    <div style={{ borderTop: '1px solid var(--danger)', background: 'var(--bg)' }}>
                                      <div style={{ padding: 'var(--space-sm) var(--space-md)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border)' }}>
                                        <span style={{ fontSize: '0.8125rem', fontWeight: 500 }}>All {knowledgeGaps.length} files</span>
                                        <button
                                          onClick={() => setExpandedKnowledgeGaps(false)}
                                          style={{
                                            fontSize: '0.75rem',
                                            color: 'var(--text2)',
                                            background: 'none',
                                            border: 'none',
                                            cursor: 'pointer',
                                            padding: '4px 8px'
                                          }}
                                        >
                                          ▲ Collapse
                                        </button>
                                      </div>
                                      <div style={{ padding: 'var(--space-md)', maxHeight: '400px', overflowY: 'auto' }}>
                                        {(() => {
                                          // Group files by folder
                                          const grouped = knowledgeGaps.reduce((acc, gap) => {
                                            const folder = gap.file.split('/').slice(0, -1).join('/') || '(root)';
                                            if (!acc[folder]) acc[folder] = [];
                                            acc[folder].push(gap);
                                            return acc;
                                          }, {} as Record<string, KnowledgeGap[]>);
                                          
                                          return Object.entries(grouped)
                                            .sort((a, b) => b[1].length - a[1].length)
                                            .map(([folder, files]) => (
                                              <div key={folder} style={{ marginBottom: 'var(--space-md)' }}>
                                                <div style={{ 
                                                  display: 'flex', 
                                                  alignItems: 'center', 
                                                  gap: 'var(--space-sm)',
                                                  marginBottom: 'var(--space-xs)',
                                                  color: 'var(--text2)',
                                                  fontSize: '0.8125rem',
                                                  fontWeight: 500
                                                }}>
                                                  <span>📁</span>
                                                  <span style={{ fontFamily: 'var(--font-mono)' }}>{folder}/</span>
                                                  <span style={{ color: 'var(--danger)', fontWeight: 'normal' }}>({files.length})</span>
                                                </div>
                                                <div style={{ 
                                                  marginLeft: 'var(--space-lg)', 
                                                  borderLeft: '1px solid var(--border)',
                                                  paddingLeft: 'var(--space-md)'
                                                }}>
                                                  {files.map((file, j) => (
                                                    <div
                                                      key={j}
                                                      onClick={() => openFileDetail(file.file)}
                                                      className="twin-row"
                                                      style={{
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: 'var(--space-sm)',
                                                        padding: 'var(--space-xs) var(--space-sm)',
                                                        marginBottom: '2px',
                                                        borderRadius: 'var(--radius-sm)',
                                                        cursor: 'pointer',
                                                        fontSize: '0.8125rem'
                                                      }}
                                                    >
                                                      <span style={{ color: 'var(--text3)' }}>├──</span>
                                                      <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text)' }}>
                                                        {file.name}
                                                      </span>
                                                      <span style={{ marginLeft: 'auto', color: 'var(--text3)' }}>→</span>
                                                    </div>
                                                  ))}
                                                </div>
                                              </div>
                                            ));
                                        })()}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              )}
                              
                              <p className="hint">
                                {ownershipTimeFilter === 'all' 
                                  ? 'Who knows each file best (most commits all time)' 
                                  : `Active files in the ${ownershipTimeFilter === '6months' ? 'last 6 months' : 'last 3 months'} — primary owner = most commits in this period`}
                              </p>
                              
                              {gitOwnership.length === 0 ? (
                                <div style={{ textAlign: 'center', padding: 'var(--space-lg)', color: 'var(--text3)' }}>
                                  No files with activity in this time period
                                </div>
                              ) : (
                                <ul className="file-list" style={{ margin: 0, padding: 0 }}>
                                  {gitOwnership.slice(0, 20).map((o, i) => (
                                    <li 
                                      key={i} 
                                      onClick={() => openFileDetail(o.file)} 
                                      style={{ 
                                        display: 'flex',
                                        flexDirection: 'column',
                                        padding: 'var(--space-sm) var(--space-md)',
                                        background: 'var(--bg2)',
                                        border: '1px solid var(--border)',
                                        borderRadius: 'var(--radius-sm)',
                                        marginBottom: 'var(--space-xs)',
                                        cursor: 'pointer',
                                        transition: 'background 0.15s'
                                      }}
                                      className="twin-row"
                                    >
                                      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
                                        <span style={{ color: 'var(--text3)', fontSize: '0.75rem', minWidth: '24px' }}>#{i + 1}</span>
                                        <span style={{ fontWeight: 500 }}>{o.name}</span>
                                        <span style={{ marginLeft: 'auto', color: 'var(--text3)' }}>→</span>
                                      </div>
                                      <div style={{ 
                                        fontSize: '0.8125rem', 
                                        color: 'var(--text2)', 
                                        marginTop: '4px',
                                        marginLeft: '32px'
                                      }}>
                                        {o.totalCommits} commits · by <strong>{o.primaryOwner}</strong> ({o.ownershipPercent}%)
                                        {o.authorCount > 1 && `, ${o.authors ? o.authors.slice(1, 3).join(', ') : ''} ${o.authorCount > 3 ? `+${o.authorCount - 3}` : ''}`}
                                      </div>
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </div>
                          )}

                          {/* BUS FACTOR TAB */}
                          {activeGitTab === 'bus-factor' && busFactor && (
                            <div className="git-content">
                              <div style={{ 
                                background: busFactor.riskPercent > 30 ? 'rgba(248,81,73,0.1)' : 'rgba(16,185,129,0.1)', 
                                border: `1px solid ${busFactor.riskPercent > 30 ? 'var(--danger)' : 'var(--success)'}`, 
                                borderRadius: 'var(--radius)', 
                                padding: 'var(--space-md)', 
                                marginBottom: 'var(--space-md)' 
                              }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)' }}>
                                  <span style={{ fontSize: '2rem' }}>{busFactor.riskPercent > 30 ? '⚠️' : '✅'}</span>
                                  <div>
                                    <div style={{ fontWeight: 600, fontSize: '1.125rem' }}>
                                      {busFactor.totalSingleAuthorFiles} files with single author ({busFactor.riskPercent}%)
                                    </div>
                                    <div style={{ color: 'var(--text2)', fontSize: '0.875rem' }}>
                                      {busFactor.riskPercent > 30 
                                        ? 'High knowledge concentration risk. Consider pair programming or code reviews.' 
                                        : 'Good knowledge distribution across the team.'}
                                    </div>
                                  </div>
                                </div>
                              </div>
                              
                              <p className="hint">
                                {ownershipTimeFilter === 'all' 
                                  ? 'Files only one person has ever touched (all time)' 
                                  : `Files only one person touched in the ${ownershipTimeFilter === '6months' ? 'last 6 months' : 'last 3 months'}`}
                              </p>
                              
                              {busFactor.busFactor.slice(0, 10).map((b, i) => (
                                <div key={i} style={{ background: 'var(--bg3)', borderRadius: 'var(--radius)', marginBottom: 'var(--space-sm)', overflow: 'hidden' }}>
                                  <button
                                    onClick={() => setExpandedBusFactorAuthor(expandedBusFactorAuthor === b.author ? null : b.author)}
                                    style={{
                                      width: '100%',
                                      display: 'flex',
                                      justifyContent: 'space-between',
                                      alignItems: 'center',
                                      padding: 'var(--space-md)',
                                      background: 'none',
                                      border: 'none',
                                      cursor: 'pointer',
                                      color: 'var(--text)',
                                      fontFamily: 'inherit'
                                    }}
                                  >
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
                                      <span style={{ color: 'var(--text3)' }}>{expandedBusFactorAuthor === b.author ? '▼' : '▶'}</span>
                                      <span style={{ fontWeight: 600 }}>👤 {b.author}</span>
                                    </div>
                                    <span style={{ 
                                      background: b.soloFiles > 10 ? 'rgba(248,81,73,0.2)' : 'var(--bg)', 
                                      color: b.soloFiles > 10 ? 'var(--danger)' : 'var(--text2)',
                                      padding: '4px 10px',
                                      borderRadius: 'var(--radius-sm)',
                                      fontSize: '0.8125rem'
                                    }}>
                                      {b.soloFiles} solo files
                                    </span>
                                  </button>
                                  
                                  {/* Collapsed preview */}
                                  {expandedBusFactorAuthor !== b.author && (
                                    <div style={{ padding: '0 var(--space-md) var(--space-md)', display: 'flex', flexWrap: 'wrap', gap: 'var(--space-xs)' }}>
                                      {b.files.slice(0, 5).map((f, j) => (
                                        <span key={j} style={{ fontSize: '0.75rem', padding: '4px 8px', background: 'var(--bg2)', borderRadius: 'var(--radius-sm)', color: 'var(--text2)' }}>
                                          {f.split('/').pop()}
                                        </span>
                                      ))}
                                      {b.files.length > 5 && (
                                        <span 
                                          style={{ fontSize: '0.75rem', padding: '4px 8px', color: 'var(--primary)', cursor: 'pointer' }}
                                          onClick={(e) => { e.stopPropagation(); setExpandedBusFactorAuthor(b.author); }}
                                        >
                                          +{b.files.length - 5} more →
                                        </span>
                                      )}
                                    </div>
                                  )}
                                  
                                  {/* Expanded: Grouped by folder */}
                                  {expandedBusFactorAuthor === b.author && (
                                    <div style={{ padding: '0 var(--space-md) var(--space-md)', borderTop: '1px solid var(--border)' }}>
                                      {(() => {
                                        const grouped = b.files.reduce((acc, file) => {
                                          const folder = file.split('/').slice(0, -1).join('/') || '(root)';
                                          if (!acc[folder]) acc[folder] = [];
                                          acc[folder].push(file);
                                          return acc;
                                        }, {} as Record<string, string[]>);
                                        
                                        return Object.entries(grouped).map(([folder, files]) => (
                                          <div key={folder} style={{ marginTop: 'var(--space-md)' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', marginBottom: 'var(--space-xs)', color: 'var(--text2)', fontSize: '0.8125rem', fontWeight: 500 }}>
                                              <span>📁</span>
                                              <span style={{ fontFamily: 'var(--font-mono)' }}>{folder}/</span>
                                              <span style={{ color: 'var(--text3)', fontWeight: 'normal' }}>({files.length})</span>
                                            </div>
                                            <div style={{ marginLeft: 'var(--space-lg)', borderLeft: '1px solid var(--border)', paddingLeft: 'var(--space-md)' }}>
                                              {files.map((file, j) => (
                                                <div
                                                  key={j}
                                                  onClick={() => openFileDetail(file)}
                                                  className="twin-row"
                                                  style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', padding: 'var(--space-xs) var(--space-sm)', marginBottom: '2px', borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontSize: '0.8125rem' }}
                                                >
                                                  <span style={{ color: 'var(--text3)' }}>├──</span>
                                                  <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text)' }}>{file.split('/').pop()}</span>
                                                  <span style={{ marginLeft: 'auto', color: 'var(--text3)' }}>→</span>
                                                </div>
                                              ))}
                                            </div>
                                          </div>
                                        ));
                                      })()}
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="welcome">
            <div className="welcome-icon" aria-hidden="true">🔍</div>
            <h1>Welcome to TSight</h1>
            <p style={{ maxWidth: '500px', margin: '0 auto var(--space-md)', color: 'var(--text2)' }}>
              Understand any TypeScript codebase in seconds.<br />
              <strong>No AI. No guessing. Just facts from your code.</strong>
            </p>
            <button className="btn btn-primary btn-large" onClick={() => setShowModal(true)}>Analyze Your First Project</button>
            <div className="features">
              <div className="feature"><span aria-hidden="true">🧠</span><span>Architecture</span></div>
              <div className="feature"><span aria-hidden="true">🔥</span><span>Hotspots</span></div>
              <div className="feature"><span aria-hidden="true">🚌</span><span>Bus Factor</span></div>
              <div className="feature"><span aria-hidden="true">📋</span><span>Issues</span></div>
            </div>
            <p style={{ fontSize: '0.75rem', color: 'var(--text3)', marginTop: 'var(--space-lg)' }}>
              Works on any TypeScript/React project · Zero setup · Runs locally
            </p>
          </div>
        )}
        {error && <div className="error-toast" onClick={() => setError(null)} role="alert">❌ {error}</div>}
      </main>

      {showModal && <AnalyzeModal onClose={() => setShowModal(false)} onAnalyze={analyzeFolder} loading={loading} timer={analysisTimer} />}
      {(selectedFile || loadingFile) && <FileDetailPanel file={selectedFile} loading={loadingFile} onClose={() => setSelectedFile(null)} onFileClick={openFileDetail} />}
      {(blastRadius || loadingBlast) && <BlastRadiusModal blastRadius={blastRadius} loading={loadingBlast} onClose={() => setBlastRadius(null)} onFileClick={openFileDetail} />}
      {showWalkthrough && <Walkthrough step={walkthroughStep} onNext={() => setWalkthroughStep(s => s + 1)} onPrev={() => setWalkthroughStep(s => s - 1)} onClose={() => setShowWalkthrough(false)} />}
      
      {/* Complex Functions Modal */}
      {showComplexFunctions && (
        <div className="modal-overlay" onClick={() => setShowComplexFunctions(false)}>
          <div className="blast-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '700px' }}>
            <div className="blast-header">
              <div>
                <h2>⚡ High Complexity Functions</h2>
                <p className="blast-file">Functions with complexity &gt; 15</p>
              </div>
              <button className="close" onClick={() => setShowComplexFunctions(false)}>×</button>
            </div>
            <div className="blast-body">
              <p className="hint" style={{ marginBottom: 'var(--space-md)' }}>
                Cyclomatic complexity counts decision points (if/else, loops, switch cases). 
                High complexity = harder to test and maintain. Consider refactoring functions above 15.
              </p>
              <ul className="file-list">
                {complexFunctions.slice(0, 30).map((f: any, i: number) => (
                  <li key={i} className="file-list-item" onClick={() => { setShowComplexFunctions(false); openFileDetail(f.file); }}>
                    <span className="rank" style={{ 
                      background: f.complexity > 30 ? 'rgba(248,81,73,0.2)' : f.complexity > 20 ? 'rgba(227,179,65,0.2)' : 'var(--bg3)',
                      color: f.complexity > 30 ? 'var(--danger)' : f.complexity > 20 ? 'var(--warning)' : 'var(--text2)'
                    }}>
                      {f.complexity}
                    </span>
                    <div className="info">
                      <span className="name">{f.name}()</span>
                      <span className="path">{f.fileName} : line {f.line}</span>
                    </div>
                    <span className="arrow">→</span>
                  </li>
                ))}
              </ul>
              {complexFunctions.length > 30 && (
                <p className="hint" style={{ textAlign: 'center', marginTop: 'var(--space-md)' }}>
                  +{complexFunctions.length - 30} more functions
                </p>
              )}
              {complexFunctions.length === 0 && (
                <div className="empty-state" style={{ textAlign: 'center', padding: 'var(--space-xl)' }}>
                  <span style={{ fontSize: '2rem' }}>✅</span>
                  <h4 style={{ color: 'var(--success)', marginTop: 'var(--space-sm)' }}>No high complexity functions!</h4>
                  <p style={{ color: 'var(--text2)' }}>All functions are under the complexity threshold.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      
      {/* Structural Twin Detail Modal */}
      {selectedTwin && (
        <div className="modal-overlay" onClick={() => setSelectedTwin(null)}>
          <div className="blast-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '800px' }}>
            <div className="blast-header">
              <div>
                <h2>🔍 Structural Comparison</h2>
                <p className="blast-file">{selectedTwin.summary}</p>
              </div>
              <button className="close" onClick={() => setSelectedTwin(null)}>×</button>
            </div>
            <div className="blast-body">
              {/* Function Pair Header */}
              <div style={{ 
                display: 'grid', 
                gridTemplateColumns: '1fr auto 1fr', 
                gap: 'var(--space-lg)', 
                alignItems: 'center',
                background: 'var(--bg3)',
                padding: 'var(--space-lg)',
                borderRadius: 'var(--radius)',
                marginBottom: 'var(--space-lg)'
              }}>
                <div 
                  style={{ cursor: 'pointer' }}
                  onClick={() => { setSelectedTwin(null); openFileDetail(selectedTwin.functionA.file); }}
                >
                  <div style={{ fontWeight: 700, fontSize: '1.1rem', color: 'var(--primary)' }}>{selectedTwin.functionA.name}()</div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text3)' }}>{selectedTwin.functionA.file}</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text3)' }}>Line {selectedTwin.functionA.line}</div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: '2rem' }}>↔</div>
                  <div style={{ 
                    background: selectedTwin.verdict === 'structural-twin' ? 'rgba(34, 197, 94, 0.2)' : 'rgba(234, 179, 8, 0.2)',
                    color: selectedTwin.verdict === 'structural-twin' ? 'var(--success)' : 'var(--warning)',
                    padding: '4px 12px',
                    borderRadius: '20px',
                    fontSize: '0.875rem',
                    fontWeight: 600
                  }}>
                    {selectedTwin.matchedCount}/{selectedTwin.totalCount} match
                  </div>
                </div>
                <div 
                  style={{ textAlign: 'right', cursor: 'pointer' }}
                  onClick={() => { setSelectedTwin(null); openFileDetail(selectedTwin.functionB.file); }}
                >
                  <div style={{ fontWeight: 700, fontSize: '1.1rem', color: 'var(--primary)' }}>{selectedTwin.functionB.name}()</div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text3)' }}>{selectedTwin.functionB.file}</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text3)' }}>Line {selectedTwin.functionB.line}</div>
                </div>
              </div>
              
              {/* Criteria Breakdown */}
              <h4 style={{ marginBottom: 'var(--space-md)', display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
                <span>📋 Criteria Breakdown</span>
                <span style={{ fontSize: '0.75rem', color: 'var(--text3)', fontWeight: 'normal' }}>
                  — Why we flagged these as similar
                </span>
              </h4>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
                {selectedTwin.criteria.map((criterion, i) => (
                  <div 
                    key={i}
                    style={{ 
                      display: 'grid',
                      gridTemplateColumns: '24px 140px 1fr 1fr',
                      gap: 'var(--space-md)',
                      alignItems: 'center',
                      padding: 'var(--space-sm) var(--space-md)',
                      background: criterion.matched ? 'rgba(34, 197, 94, 0.08)' : 'var(--bg2)',
                      borderRadius: 'var(--radius)',
                      border: `1px solid ${criterion.matched ? 'rgba(34, 197, 94, 0.3)' : 'var(--border)'}`
                    }}
                  >
                    <span style={{ fontSize: '1rem' }}>
                      {criterion.matched ? '✅' : '❌'}
                    </span>
                    <span style={{ fontWeight: 600, fontSize: '0.875rem' }}>
                      {criterion.name}
                    </span>
                    <div style={{ fontSize: '0.8rem' }}>
                      <span style={{ color: 'var(--text3)' }}>A: </span>
                      <code style={{ 
                        background: 'var(--bg3)', 
                        padding: '2px 6px', 
                        borderRadius: '3px',
                        fontSize: '0.75rem'
                      }}>
                        {criterion.valueA}
                      </code>
                    </div>
                    <div style={{ fontSize: '0.8rem' }}>
                      <span style={{ color: 'var(--text3)' }}>B: </span>
                      <code style={{ 
                        background: 'var(--bg3)', 
                        padding: '2px 6px', 
                        borderRadius: '3px',
                        fontSize: '0.75rem'
                      }}>
                        {criterion.valueB}
                      </code>
                    </div>
                  </div>
                ))}
              </div>
              
              {/* Disclaimer */}
              <div style={{ 
                marginTop: 'var(--space-lg)', 
                padding: 'var(--space-md)', 
                background: 'rgba(234, 179, 8, 0.1)', 
                borderRadius: 'var(--radius)',
                border: '1px solid rgba(234, 179, 8, 0.3)'
              }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-sm)' }}>
                  <span style={{ fontSize: '1.25rem' }}>⚠️</span>
                  <div style={{ fontSize: '0.875rem' }}>
                    <strong>Review before refactoring:</strong> These functions have similar <em>structure</em>, 
                    but may serve different <em>purposes</em>. Check their actual behavior and context 
                    before consolidating.
                  </div>
                </div>
              </div>
            </div>
            
            <div className="blast-footer" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', gap: 'var(--space-sm)' }}>
                <button 
                  className="btn btn-secondary" 
                  onClick={() => { setSelectedTwin(null); openFileDetail(selectedTwin.functionA.file); }}
                >
                  View {selectedTwin.functionA.name}
                </button>
                <button 
                  className="btn btn-secondary" 
                  onClick={() => { setSelectedTwin(null); openFileDetail(selectedTwin.functionB.file); }}
                >
                  View {selectedTwin.functionB.name}
                </button>
              </div>
              <button className="btn btn-primary" onClick={() => setSelectedTwin(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function InsightCard({ icon, count, label, desc, active, warning, onClick }: { icon: string; count: number; label: string; desc: string; active: boolean; warning?: boolean; onClick: () => void }) {
  return (
    <button className={`insight-card ${active ? 'active' : ''}`} onClick={onClick} aria-expanded={active} style={warning ? { borderColor: 'var(--warning)' } : undefined}>
      <div className="insight-icon" aria-hidden="true">{icon}</div>
      <span className="insight-count" style={warning ? { color: 'var(--warning)' } : undefined}>{count}</span>
      <span className="insight-label">{label}</span>
      <span className="insight-desc">{desc}</span>
    </button>
  );
}

function InsightDetails({ type, insights, godFiles, onFileClick, onClose, onBlastRadius }: { type: string; insights: DependencyInsights; godFiles?: Array<{ file: string; name: string; lines: number; exports: number; functions: number; reasons: string[] }>; onFileClick: (f: string) => void; onClose: () => void; onBlastRadius: (f: string) => void }) {
  const titles: Record<string, string> = {
    core: '🎯 Core Files — these are imported by many others',
    hotspots: '🔥 Hotspots — complex files with many dependents (high risk to change)',
    isolated: '🏝️ Isolated Files — no internal imports or dependents',
    circular: '🔄 Circular Dependencies — import cycles detected',
    'god-files': '📦 Large Files — files that may need splitting'
  };
  
  return (
    <div className="insight-details">
      <div className="insight-details-header">
        <h4>{titles[type] || type}</h4>
        <button className="insight-details-close" onClick={onClose} aria-label="Close">×</button>
      </div>
      <div className="insight-details-body">
        {type === 'core' && (
          <ul className="file-list">
            {insights.coreFiles.slice(0, 15).map((f, i) => (
              <li key={i} className="file-list-item">
                <span className="rank">#{i + 1}</span>
                <div className="info" onClick={() => onFileClick(f.file)} style={{ cursor: 'pointer' }}><span className="name">{f.name}</span><span className="path">{f.file}</span></div>
                <div className="bar"><div className="bar-fill" style={{ width: `${(f.dependentCount / insights.coreFiles[0].dependentCount) * 100}%` }} /></div>
                <span className="count">{f.dependentCount} deps</span>
                <button className="blast-btn" onClick={() => onBlastRadius(f.file)} title="View blast radius" aria-label="View blast radius">💥</button>
              </li>
            ))}
          </ul>
        )}
        {type === 'hotspots' && (
          <div>
            <p className="hint" style={{ marginBottom: '16px' }}>Risk Score = Complexity × Dependents. Higher = more dangerous to change.</p>
            <ul className="file-list">
              {insights.hotspots.map((h, i) => (
                <li key={i} className="hotspot-item">
                  <div className="hotspot-header">
                    <span className={`risk-badge risk-${h.riskLevel}`}>{h.riskLevel}</span>
                    <div className="info" onClick={() => onFileClick(h.file)} style={{ cursor: 'pointer', flex: 1 }}>
                      <span className="name">{h.name}</span>
                      <span className="path">{h.file}</span>
                    </div>
                    <div className="hotspot-stats">
                      <span className="stat-pill">⚡ {h.complexity} complexity</span>
                      <span className="stat-pill">📥 {h.dependents} dependents</span>
                      <span className="stat-pill score">🎯 {h.riskScore} risk</span>
                    </div>
                    <button className="blast-btn" onClick={() => onBlastRadius(h.file)} title="View blast radius" aria-label="View blast radius">💥</button>
                  </div>
                  {h.functions.length > 0 && (
                    <div className="hotspot-functions">
                      <span className="functions-label">Complex functions:</span>
                      {h.functions.map((fn, j) => (
                        <span key={j} className="function-tag" title={`Line ${fn.line}`}>
                          {fn.name}({fn.complexity})
                        </span>
                      ))}
                    </div>
                  )}
                </li>
              ))}
              {insights.hotspots.length === 0 && <p className="hint" style={{ textAlign: 'center', padding: '24px' }}>✅ No hotspots found — your codebase is well-balanced!</p>}
            </ul>
          </div>
        )}
        {type === 'isolated' && (
          <ul className="file-list">
            {insights.isolatedFiles.slice(0, 20).map((f, i) => (
              <li key={i} className="file-list-item" onClick={() => onFileClick(f.file)}>
                <span className="rank">{i + 1}</span>
                <div className="info"><span className="name">{f.name}</span><span className="path">{f.file}</span></div>
                <span className="arrow" aria-hidden="true">→</span>
              </li>
            ))}
            {insights.isolatedFiles.length > 20 && <li className="file-list-item" style={{ justifyContent: 'center', color: 'var(--text3)', cursor: 'default' }}>+{insights.isolatedFiles.length - 20} more</li>}
          </ul>
        )}
        {type === 'god-files' && godFiles && (
          <div>
            <p className="hint" style={{ marginBottom: '16px' }}>Large files often do too much. Consider splitting into smaller, focused modules.</p>
            <ul className="file-list">
              {godFiles.slice(0, 20).map((f, i) => (
                <li key={i} className="hotspot-item">
                  <div className="hotspot-header">
                    <span className="rank">#{i + 1}</span>
                    <div className="info" onClick={() => onFileClick(f.file)} style={{ cursor: 'pointer', flex: 1 }}>
                      <span className="name">{f.name}</span>
                      <span className="path">{f.file}</span>
                    </div>
                    <div className="hotspot-stats">
                      <span className="stat-pill">📝 {f.lines} lines</span>
                      <span className="stat-pill">📤 {f.exports} exports</span>
                      <span className="stat-pill">ƒ {f.functions} functions</span>
                    </div>
                    <button className="blast-btn" onClick={() => onBlastRadius(f.file)} title="View blast radius" aria-label="View blast radius">💥</button>
                  </div>
                  <div className="hotspot-functions">
                    <span className="functions-label">Issues:</span>
                    {f.reasons.map((r, j) => (
                      <span key={j} className="function-tag" style={{ background: 'rgba(210,153,34,0.2)', color: 'var(--warning)' }}>{r}</span>
                    ))}
                  </div>
                </li>
              ))}
              {godFiles.length === 0 && <p className="hint" style={{ textAlign: 'center', padding: '24px' }}>✅ No oversized files found!</p>}
            </ul>
          </div>
        )}
        {type === 'circular' && (
          insights.circularDeps.length > 0 ? (
            insights.circularDeps.map((dep, i) => (
              <div key={i} className="cycle-item">
                <div className="cycle-path">
                  {dep.cycle.map((file, j) => (
                    <React.Fragment key={j}>
                      <button className="cycle-node" onClick={() => onFileClick(file)}>{file.split('/').pop()?.replace(/\.(ts|tsx)$/, '')}</button>
                      <span className="cycle-arrow">→</span>
                    </React.Fragment>
                  ))}
                  <span className="cycle-node" style={{ opacity: 0.5 }}>{dep.cycle[0].split('/').pop()?.replace(/\.(ts|tsx)$/, '')}</span>
                </div>
              </div>
            ))
          ) : <p className="hint" style={{ textAlign: 'center', padding: '24px' }}>✅ No circular dependencies found</p>
        )}
      </div>
    </div>
  );
}

function LanguageBar({ languages }: { languages: Array<{ language: string; percentage: number; color: string }> }) {
  return (
    <div className="language-section">
      <div className="language-bar" role="img" aria-label="Language distribution">{languages.map((l, i) => <div key={i} className="segment" style={{ width: `${l.percentage}%`, backgroundColor: l.color }} title={`${l.language}: ${l.percentage}%`} />)}</div>
      <div className="legend">{languages.map((l, i) => <div key={i} className="item"><span className="dot" style={{ backgroundColor: l.color }} aria-hidden="true" /><span className="name">{l.language}</span><span className="pct">{l.percentage}%</span></div>)}</div>
    </div>
  );
}

function FileDetailPanel({ file, loading, onClose, onFileClick }: { file: FileDetail | null; loading: boolean; onClose: () => void; onFileClick: (path: string) => void }) {
  const [tab, setTab] = useState<'overview' | 'exports' | 'deps'>('overview');
  const [showFullGraph, setShowFullGraph] = useState(false);
  
  // Download file as markdown
  const downloadAsMd = () => {
    if (!file) return;
    
    let md = `# 📄 ${file.name}

## Overview

| Property | Value |
|----------|-------|
| **Path** | \`${file.path}\` |
| **Lines** | ${file.lines} |
| **Exports** | ${file.metrics.totalExports} |
| **Imports** | ${file.metrics.importCount} |
| **Dependents** | ${file.metrics.dependentCount} |

### Summary

${file.crux}

`;

    // Classes
    if (file.classes.length > 0) {
      md += `---

## Classes

`;
      file.classes.forEach(c => {
        md += `### ${c.name}${c.exported ? ' *(exported)*' : ''}

- **Methods:** ${c.methods}
- **Line:** ${c.line}

`;
      });
    }

    // Functions
    if (file.functions.length > 0) {
      md += `---

## Functions

| Name | Complexity | Async | Exported | Line |
|------|------------|-------|----------|------|
`;
      file.functions.forEach(f => {
        md += `| \`${f.name}()\` | ${f.complexity} | ${f.async ? '✓' : '—'} | ${f.exported ? '✓' : '—'} | ${f.line} |\n`;
      });
      md += `\n`;
    }

    // Interfaces
    if (file.interfaces.length > 0) {
      md += `---

## Interfaces

| Name | Properties | Exported |
|------|------------|----------|
`;
      file.interfaces.forEach(i => {
        md += `| \`${i.name}\` | ${i.properties} | ${i.exported ? '✓' : '—'} |\n`;
      });
      md += `\n`;
    }

    // Dependencies
    md += `---

## Dependencies

### Imports (${file.imports.length})

`;
    if (file.imports.length > 0) {
      file.imports.forEach(imp => {
        md += `- ${imp.isExternal ? '📦' : '📄'} \`${imp.module}\`${imp.isExternal ? ' *(external)*' : ''}\n`;
      });
    } else {
      md += `_No imports_\n`;
    }

    md += `
### Used By (${file.importedBy.length})

`;
    if (file.importedBy.length > 0) {
      file.importedBy.forEach(d => {
        md += `- 📄 \`${d.file}\`\n`;
      });
    } else {
      md += `_No files import this_\n`;
    }

    // Issues
    if (file.issues.length > 0) {
      md += `
---

## ⚠️ Issues

`;
      file.issues.forEach(issue => {
        md += `- ${issue.message}\n`;
      });
    }

    // Food for Thought - only things we can confidently detect
    const suggestions: Array<{ what: string; consider: string }> = [];
    
    // High complexity functions
    const complexFunctions = file.functions.filter(f => f.complexity > 10);
    if (complexFunctions.length > 0) {
      complexFunctions.forEach(f => {
        suggestions.push({
          what: `\`${f.name}()\` has complexity ${f.complexity}`,
          consider: 'Could this be broken into smaller functions?'
        });
      });
    }
    
    // Large file
    if (file.lines > 500) {
      suggestions.push({
        what: `File has ${file.lines} lines`,
        consider: 'Could this be split into smaller modules?'
      });
    }
    
    // Many imports (doing too much?)
    if (file.imports.length > 15) {
      suggestions.push({
        what: `File has ${file.imports.length} imports`,
        consider: 'Is this file responsible for too many things?'
      });
    }
    
    // Many dependents (risky to change)
    if (file.metrics.dependentCount > 10) {
      suggestions.push({
        what: `${file.metrics.dependentCount} files depend on this`,
        consider: 'Changes here have wide impact — consider adding tests'
      });
    }
    
    // No exports (potential dead code or entry point)
    if (file.metrics.totalExports === 0 && file.imports.length > 0) {
      suggestions.push({
        what: 'File has no exports but has imports',
        consider: 'Is this an entry point, or possibly unused?'
      });
    }
    
    // Many functions without exports
    const unexportedFunctions = file.functions.filter(f => !f.exported);
    if (unexportedFunctions.length > 5 && file.functions.length > 0) {
      const pct = Math.round((unexportedFunctions.length / file.functions.length) * 100);
      if (pct > 70) {
        suggestions.push({
          what: `${pct}% of functions are not exported`,
          consider: 'Are all these internal helpers necessary?'
        });
      }
    }
    
    // Add suggestions section if we have any
    if (suggestions.length > 0) {
      md += `
---

## 💡 Food for Thought

> These are patterns we noticed — not prescriptions. You know your code best.

| What We Observed | Something to Consider |
|------------------|----------------------|
`;
      suggestions.forEach(s => {
        md += `| ${s.what} | ${s.consider} |\n`;
      });
    }

    md += `
---

> _Generated by TSight_
`;

    // Download
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${file.name.replace(/\.(ts|tsx)$/, '')}-docs.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };
  
  if (loading) return <div className="panel-overlay" onClick={onClose}><div className="panel" onClick={e => e.stopPropagation()}><div className="panel-loading"><div className="spinner" aria-hidden="true" />Loading...</div></div></div>;
  if (!file) return null;

  const mermaidCode = generateMermaidDiagram(file);

  return (
    <div className="panel-overlay" onClick={onClose}>
      <div className="panel" onClick={e => e.stopPropagation()} role="dialog" aria-label={`File details: ${file.name}`}>
        <div className="panel-header">
          <div><h2>📄 {file.name}</h2><p className="path">{file.path}</p></div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
            <button 
              onClick={downloadAsMd} 
              className="btn btn-primary" 
              style={{ 
                padding: '6px 12px', 
                fontSize: '0.8125rem',
                display: 'flex',
                alignItems: 'center',
                gap: '4px'
              }}
              title="Download file documentation as Markdown"
            >
              <span>📥</span>
              <span>Export .MD</span>
            </button>
            <button className="close" onClick={onClose} aria-label="Close panel">×</button>
          </div>
        </div>
        <div className="panel-body">
          <div className="panel-stats">
            <div className="stat"><span className="value">{file.lines}</span><span className="label">lines</span></div>
            <div className="stat"><span className="value">{file.metrics.totalExports}</span><span className="label">exports</span></div>
            <div className="stat"><span className="value">{file.metrics.importCount}</span><span className="label">imports</span></div>
            <div className="stat"><span className="value">{file.metrics.dependentCount}</span><span className="label">dependents</span></div>
          </div>
          
          <div className="panel-crux"><p>{file.crux}</p></div>
          
          <div className="panel-mental-model">
            <div className="mental-model-header">
              <h4>🧠 Mental Model</h4>
              <button className="expand-btn" onClick={() => setShowFullGraph(true)} title="Expand diagram" aria-label="Expand diagram">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>
              </button>
            </div>
            <MermaidDiagram code={mermaidCode} />
          </div>

          <div className="panel-tabs" role="tablist">
            <button className={tab === 'overview' ? 'active' : ''} onClick={() => setTab('overview')} role="tab" aria-selected={tab === 'overview'}>Contents</button>
            <button className={tab === 'exports' ? 'active' : ''} onClick={() => setTab('exports')} role="tab" aria-selected={tab === 'exports'}>Exports ({file.allExports.length})</button>
            <button className={tab === 'deps' ? 'active' : ''} onClick={() => setTab('deps')} role="tab" aria-selected={tab === 'deps'}>All Deps</button>
          </div>
          
          <div className="panel-content" role="tabpanel">
            {tab === 'overview' && (
              <div className="contents">
                {file.classes.length > 0 && <div className="group"><h5>Classes</h5>{file.classes.map((c, i) => <div key={i} className="item"><span className="icon" aria-hidden="true">🔷</span><span className="name">{c.name}</span>{c.exported && <span className="badge">exported</span>}<span className="meta">{c.methods} methods</span></div>)}</div>}
                {file.functions.length > 0 && <div className="group"><h5>Functions</h5>{file.functions.map((f, i) => <div key={i} className="item"><span className="icon" aria-hidden="true">{f.async ? '⚡' : 'ƒ'}</span><span className="name">{f.name}</span>{f.exported && <span className="badge">exported</span>}<span className="meta">complexity: {f.complexity}</span></div>)}</div>}
                {file.interfaces.length > 0 && <div className="group"><h5>Interfaces</h5>{file.interfaces.map((iface, i) => <div key={i} className="item"><span className="icon" aria-hidden="true">◇</span><span className="name">{iface.name}</span>{iface.exported && <span className="badge">exported</span>}<span className="meta">{iface.properties} props</span></div>)}</div>}
                {file.classes.length === 0 && file.functions.length === 0 && file.interfaces.length === 0 && <p className="empty">No classes, functions, or interfaces found</p>}
              </div>
            )}
            {tab === 'exports' && <div className="exports">{file.allExports.length > 0 ? file.allExports.map((e, i) => <div key={i} className="export"><span className={`type type-${e.type}`}>{e.type}</span><span className="name">{e.name}</span><span className="line">:{e.line}</span></div>) : <p className="empty">No exports</p>}</div>}
            {tab === 'deps' && (
              <div className="deps">
                <h5>Imports ({file.imports.length})</h5>
                {file.imports.map((imp, i) => <div key={i} className={`dep ${!imp.isExternal ? 'clickable' : ''}`} onClick={() => !imp.isExternal && onFileClick(imp.module)}><span className="icon" aria-hidden="true">{imp.isExternal ? '📦' : '📄'}</span><span className="name">{imp.module}</span>{!imp.isExternal && <span className="arrow" aria-hidden="true">→</span>}</div>)}
                <h5 style={{ marginTop: '16px' }}>Used By ({file.importedBy.length})</h5>
                {file.importedBy.length > 0 ? file.importedBy.map((d, i) => <div key={i} className="dep clickable" onClick={() => onFileClick(d.file)}><span className="icon" aria-hidden="true">📄</span><span className="name">{d.file}</span><span className="arrow" aria-hidden="true">→</span></div>) : <p className="empty">No files import this</p>}
              </div>
            )}
          </div>

          {file.issues.length > 0 && <div className="panel-issues"><h4>⚠️ Issues</h4>{file.issues.map((issue, i) => <div key={i} className="issue">{issue.message}</div>)}</div>}
        </div>
      </div>
      
      {showFullGraph && (
        <div className="graph-modal" onClick={() => setShowFullGraph(false)}>
          <div className="graph-modal-content" onClick={e => e.stopPropagation()}>
            <div className="graph-modal-header"><h3>🧠 Mental Model: {file.name}</h3><button className="close" onClick={() => setShowFullGraph(false)} aria-label="Close">×</button></div>
            <div className="graph-modal-body"><MermaidDiagram code={mermaidCode} fullscreen /></div>
            <div className="graph-modal-footer"><span className="hint">Use zoom controls to navigate</span></div>
          </div>
        </div>
      )}
    </div>
  );
}

function generateMermaidDiagram(file: FileDetail): string {
  const fileName = file.name.replace(/\.(ts|tsx)$/, '');
  const lines: string[] = ['flowchart TB'];
  
  const internalImports = file.imports.filter(i => !i.isExternal);
  const externalImports = file.imports.filter(i => i.isExternal);
  
  if (internalImports.length > 0) {
    lines.push('  subgraph uses["📥 Uses"]');
    internalImports.slice(0, 6).forEach((imp, i) => {
      const modName = imp.module.split('/').pop()?.replace(/\.(ts|tsx)$/, '') || `m${i}`;
      lines.push(`    u${i}["${modName}"]`);
    });
    if (internalImports.length > 6) lines.push(`    umore["+${internalImports.length - 6} more"]`);
    lines.push('  end');
  }
  
  if (externalImports.length > 0) {
    lines.push('  subgraph pkg["📦 Packages"]');
    externalImports.slice(0, 4).forEach((imp, i) => {
      const pkgName = imp.module.split('/')[0];
      lines.push(`    p${i}["${pkgName}"]`);
    });
    if (externalImports.length > 4) lines.push(`    pmore["+${externalImports.length - 4} more"]`);
    lines.push('  end');
  }
  
  lines.push(`  current(["🎯 ${fileName}"])`);
  lines.push(`  style current fill:#58a6ff,color:#000,stroke:#58a6ff`);
  
  if (file.importedBy.length > 0) {
    lines.push('  subgraph usedby["📤 Used By"]');
    file.importedBy.slice(0, 6).forEach((dep, i) => {
      const depName = dep.file.split('/').pop()?.replace(/\.(ts|tsx)$/, '') || `d${i}`;
      lines.push(`    d${i}["${depName}"]`);
    });
    if (file.importedBy.length > 6) lines.push(`    dmore["+${file.importedBy.length - 6} more"]`);
    lines.push('  end');
  }
  
  if (internalImports.length > 0) lines.push('  uses --> current');
  if (externalImports.length > 0) lines.push('  pkg -.-> current');
  if (file.importedBy.length > 0) lines.push('  current --> usedby');
  
  lines.push('  style uses fill:#1a1a2e,stroke:#3fb950,color:#3fb950');
  lines.push('  style pkg fill:#1a1a2e,stroke:#d29922,color:#d29922');
  lines.push('  style usedby fill:#1a1a2e,stroke:#58a6ff,color:#58a6ff');
  
  return lines.join('\n');
}

function MermaidDiagram({ code, fullscreen }: { code: string; fullscreen?: boolean }) {
  const [svg, setSvg] = React.useState<string>('');
  const [scale, setScale] = React.useState(1);
  
  React.useEffect(() => {
    const load = async () => {
      // @ts-ignore
      if (!window.mermaid) {
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js';
        script.onload = () => { 
          // @ts-ignore
          window.mermaid.initialize({ startOnLoad: false, theme: 'dark', themeVariables: { primaryColor: '#58a6ff', primaryTextColor: '#e6edf3', lineColor: '#8b949e', background: '#0d1117', mainBkg: '#161b22', nodeBorder: '#30363d' }});
          render();
        };
        document.head.appendChild(script);
      } else { render(); }
    };
    
    const render = async () => {
      try {
        // @ts-ignore
        const { svg } = await window.mermaid.render('m' + Math.random().toString(36).slice(2), code);
        setSvg(svg);
      } catch (e) { console.error('Mermaid error:', e); }
    };
    
    load();
  }, [code]);

  return (
    <div className={`mermaid-container ${fullscreen ? 'fullscreen' : ''}`}>
      {fullscreen && (
        <div className="mermaid-controls">
          <button onClick={() => setScale(s => Math.max(s - 0.25, 0.5))} aria-label="Zoom out">−</button>
          <span>{Math.round(scale * 100)}%</span>
          <button onClick={() => setScale(s => Math.min(s + 0.25, 3))} aria-label="Zoom in">+</button>
          <button onClick={() => setScale(1)} aria-label="Reset zoom">↺</button>
        </div>
      )}
      <div className="mermaid-svg" style={{ transform: `scale(${scale})`, transformOrigin: 'center top' }} dangerouslySetInnerHTML={{ __html: svg || '<div class="mermaid-loading">Loading diagram...</div>' }} />
    </div>
  );
}

function Walkthrough({ step, onNext, onPrev, onClose }: { step: number; onNext: () => void; onPrev: () => void; onClose: () => void }) {
  const steps = [
    {
      title: "Welcome to TSight! 👋",
      icon: "🔍",
      content: "TSight helps you understand your TypeScript codebase at a glance. Every number you see is real — parsed directly from your code, not guessed.",
      tip: "Let's take a quick tour of what you can do here."
    },
    {
      title: "Stats Overview",
      icon: "📊",
      content: "The top row shows key metrics: total files, lines of code, classes, functions, and average complexity. These give you a quick health check of the codebase.",
      tip: "Complexity > 10 might indicate areas that need refactoring."
    },
    {
      title: "Dependency Insights",
      icon: "🔗",
      content: "This is where it gets interesting. Five cards show different views of your codebase:",
      details: [
        "🎯 Core Files — imported by 5+ other files. These are your foundation.",
        "🔥 Hotspots — complex AND heavily used. Dangerous to change!",
        "🏝️ Isolated — no connections. Possibly dead code?",
        "🔄 Circular — import cycles that could cause issues.",
        "📦 Large Files — files that may need splitting."
      ],
      tip: "Click any card to see the actual files with full details."
    },
    {
      title: "Hotspots Explained",
      icon: "🔥",
      content: "Hotspots use a simple formula: Risk = Complexity × Dependents. A file with complexity 15 and 20 dependents has risk score 300.",
      details: [
        "High complexity = many if/else, loops, branches",
        "Many dependents = lots of files import this",
        "High risk = change carefully, test thoroughly"
      ],
      tip: "We also show which specific functions are most complex."
    },
    {
      title: "Blast Radius 💥",
      icon: "💥",
      content: "Click the 💥 button on any file to see its blast radius — exactly which files would be affected if you change it.",
      details: [
        "Direct impact = files that import this directly",
        "Indirect impact = files affected through the chain",
        "Shows a visual tree of all affected files"
      ],
      tip: "Use this before refactoring to understand the risk."
    },
    {
      title: "Structural Twins 🔍",
      icon: "🔍",
      content: "In the Issues tab, we detect functions with identical STRUCTURE but different names. This is honest similarity detection — we show exactly why they matched.",
      details: [
        "We compare 8 discrete criteria: params, types, return, async, size, control flow, error handling, patterns",
        "Each criterion shows ✅ or ❌ with actual values",
        "No fuzzy percentages — just '6/8 criteria matched'",
        "⚠️ Structural ≠ semantic. Review before refactoring!"
      ],
      tip: "Click any pair to see the full criteria breakdown."
    },
    {
      title: "Search Everything",
      icon: "🔎",
      content: "The Search tab lets you find any class, function, interface, or file. Click a result to see its full details including:",
      details: [
        "📄 What the file contains (classes, functions)",
        "🧠 Mental Model diagram showing connections",
        "📥 What it imports and what imports it"
      ],
      tip: "Every item is clickable — explore freely!"
    },
    {
      title: "Git History Insights",
      icon: "📊",
      content: "The Git Insights tab reads your local .git folder (no API token needed!) to show team dynamics and knowledge distribution:",
      details: [
        "📈 File Churn — files changed most often (high churn = high risk)",
        "👥 Ownership — who knows each file best, based on commits",
        "🚌 Bus Factor — files only one person has touched (knowledge risk!)",
        "🚨 Knowledge Gaps — files no one touched recently (when filtered by time)"
      ],
      tip: "Use the time filter to see 'Last 6 months' vs 'All Time' — great for teams that recently took over a codebase!"
    },
    {
      title: "You're Ready!",
      icon: "🚀",
      content: "That's the essentials. Remember: every number comes from real code analysis. No AI guessing, no estimates — just facts you can verify.",
      tip: "Click '❓ Guide' anytime to see this walkthrough again."
    }
  ];

  const currentStep = steps[step];
  const isFirst = step === 0;
  const isLast = step === steps.length - 1;

  return (
    <div className="walkthrough-overlay" onClick={onClose}>
      <div className="walkthrough-modal" onClick={e => e.stopPropagation()}>
        <div className="walkthrough-header">
          <span className="walkthrough-icon">{currentStep.icon}</span>
          <h2>{currentStep.title}</h2>
          <button className="close" onClick={onClose} aria-label="Close walkthrough">×</button>
        </div>
        
        <div className="walkthrough-body">
          <p className="walkthrough-content">{currentStep.content}</p>
          
          {currentStep.details && (
            <ul className="walkthrough-details">
              {currentStep.details.map((detail, i) => (
                <li key={i}>{detail}</li>
              ))}
            </ul>
          )}
          
          <div className="walkthrough-tip">
            <span className="tip-icon">💡</span>
            <span>{currentStep.tip}</span>
          </div>
        </div>
        
        <div className="walkthrough-footer">
          <div className="walkthrough-progress">
            {steps.map((_, i) => (
              <span key={i} className={`progress-dot ${i === step ? 'active' : ''} ${i < step ? 'done' : ''}`} />
            ))}
          </div>
          
          <div className="walkthrough-actions">
            {!isFirst && (
              <button className="btn btn-secondary" onClick={onPrev}>← Back</button>
            )}
            {!isLast ? (
              <button className="btn btn-primary" onClick={onNext}>Next →</button>
            ) : (
              <button className="btn btn-primary" onClick={onClose}>Get Started 🚀</button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function AnalyzeModal({ onClose, onAnalyze, loading, timer }: { onClose: () => void; onAnalyze: (path: string) => void; loading: boolean; timer?: number }) {
  const [path, setPath] = useState('');
  
  // Format timer as MM:SS
  const formatTimer = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };
  
  // Dynamic status messages based on elapsed time
  const getStatusMessage = (seconds: number) => {
    const stages = [
      { time: 0, text: 'Starting analysis...', icon: '🔍' },
      { time: 2, text: 'Scanning files...', icon: '📂' },
      { time: 4, text: 'Parsing TypeScript...', icon: '📝' },
      { time: 7, text: 'Building dependency graph...', icon: '🔗' },
      { time: 10, text: 'Analyzing complexity...', icon: '🧮' },
      { time: 14, text: 'Detecting duplicates...', icon: '📋' },
      { time: 18, text: 'Finding circular dependencies...', icon: '🔄' },
      { time: 22, text: 'Calculating hotspots...', icon: '🔥' },
      { time: 26, text: 'Building mental model...', icon: '🧠' },
      { time: 30, text: 'Almost there...', icon: '⏳' },
      { time: 40, text: 'Large codebase, still working...', icon: '💪' },
      { time: 60, text: 'This is a big one! Hang tight...', icon: '🏗️' },
    ];
    
    // Find the appropriate stage
    for (let i = stages.length - 1; i >= 0; i--) {
      if (seconds >= stages[i].time) {
        return stages[i];
      }
    }
    return stages[0];
  };
  
  const status = getStatusMessage(timer || 0);
  
  return (
    <div className="modal-overlay" onClick={loading ? undefined : onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} role="dialog" aria-labelledby="modal-title">
        <div className="modal-header"><h2 id="modal-title">{loading ? 'Analyzing...' : 'Analyze Project'}</h2>{!loading && <button className="close" onClick={onClose} aria-label="Close">×</button>}</div>
        {loading ? (
          <div className="modal-body" style={{ textAlign: 'center', padding: 'var(--space-xl)' }}>
            <div className="spinner large" style={{ margin: '0 auto var(--space-md)' }} />
            <div style={{ 
              fontSize: '2.5rem', 
              fontFamily: 'var(--font-mono)', 
              color: 'var(--primary)',
              fontWeight: 600,
              margin: 'var(--space-md) 0'
            }}>
              ⏱️ {formatTimer(timer || 0)}
            </div>
            <p style={{ 
              color: 'var(--text)', 
              margin: 0,
              fontSize: '1rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 'var(--space-sm)'
            }}>
              <span style={{ fontSize: '1.25rem' }}>{status.icon}</span>
              <span>{status.text}</span>
            </p>
          </div>
        ) : (
          <form onSubmit={e => { e.preventDefault(); if (path.trim()) onAnalyze(path.trim()); }}>
            <div className="modal-body">
              <label className="form-label" htmlFor="project-path">Project Folder Path</label>
              <input id="project-path" type="text" className="form-input" placeholder="C:\path\to\project" value={path} onChange={e => setPath(e.target.value)} autoFocus disabled={loading} />
              <p className="form-hint">Full path to TypeScript/React project</p>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={!path.trim() || loading}>Analyze</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

function BlastRadiusModal({ blastRadius, loading, onClose, onFileClick }: { blastRadius: BlastRadius | null; loading: boolean; onClose: () => void; onFileClick: (f: string) => void }) {
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({});
  
  const toggleFolder = (key: string) => {
    setExpandedFolders(prev => ({ ...prev, [key]: !prev[key] }));
  };
  
  // Group files by folder
  const groupByFolder = (files: Array<{ file: string; name: string }>) => {
    const groups: Record<string, Array<{ file: string; name: string }>> = {};
    for (const f of files) {
      const parts = f.file.split('/');
      parts.pop(); // remove filename
      const folder = parts.length > 0 ? parts.join('/') : '(root)';
      if (!groups[folder]) groups[folder] = [];
      groups[folder].push(f);
    }
    // Sort folders by file count descending
    return Object.entries(groups).sort((a, b) => b[1].length - a[1].length);
  };

  if (loading) {
    return (
      <div className="modal-overlay" onClick={onClose}>
        <div className="blast-modal" onClick={e => e.stopPropagation()}>
          <div className="panel-loading"><div className="spinner" aria-hidden="true" />Calculating blast radius...</div>
        </div>
      </div>
    );
  }
  
  if (!blastRadius) return null;
  
  const riskColors: Record<string, string> = {
    low: 'var(--success)',
    medium: 'var(--warning)',
    high: '#f97316',
    critical: 'var(--danger)'
  };
  
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="blast-modal" onClick={e => e.stopPropagation()} role="dialog" aria-labelledby="blast-title">
        <div className="blast-header">
          <div>
            <h2 id="blast-title">💥 Blast Radius Analysis</h2>
            <p className="blast-file">{blastRadius.name}</p>
          </div>
          <button className="close" onClick={onClose} aria-label="Close">×</button>
        </div>
        
        <div className="blast-body">
          {/* Summary Stats */}
          <div className="blast-summary">
            <div className="blast-stat">
              <span className="blast-stat-value" style={{ color: riskColors[blastRadius.riskLevel] }}>{blastRadius.totalImpact}</span>
              <span className="blast-stat-label">Total Files Affected</span>
            </div>
            <div className="blast-stat">
              <span className="blast-stat-value">{blastRadius.directImpact}</span>
              <span className="blast-stat-label">Direct (1 level)</span>
            </div>
            <div className="blast-stat">
              <span className="blast-stat-value">{blastRadius.indirectImpact}</span>
              <span className="blast-stat-label">Indirect (2+ levels)</span>
            </div>
            <div className="blast-stat">
              <span className="blast-stat-value">{blastRadius.percentageImpact}%</span>
              <span className="blast-stat-label">of Codebase</span>
            </div>
          </div>
          
          {/* Risk Level Banner */}
          <div className={`blast-risk blast-risk-${blastRadius.riskLevel}`}>
            <span className="risk-icon">{blastRadius.riskLevel === 'critical' ? '🚨' : blastRadius.riskLevel === 'high' ? '⚠️' : blastRadius.riskLevel === 'medium' ? '⚡' : '✅'}</span>
            <span className="risk-text">
              {blastRadius.riskLevel === 'critical' && 'CRITICAL RISK — Changing this file could break significant parts of the codebase'}
              {blastRadius.riskLevel === 'high' && 'HIGH RISK — This file has broad impact, test thoroughly before changing'}
              {blastRadius.riskLevel === 'medium' && 'MEDIUM RISK — Some files depend on this, review changes carefully'}
              {blastRadius.riskLevel === 'low' && 'LOW RISK — Few dependencies, relatively safe to modify'}
            </span>
          </div>
          
          {/* Impact Tree - Grouped by Folder */}
          {blastRadius.levels.length > 0 ? (
            <div className="blast-tree">
              <h4>Impact Tree</h4>
              <p className="hint">Files affected at each level — grouped by folder. Click folder to expand.</p>
              
              <div className="tree-visualization">
                <div className="tree-root">
                  <span className="tree-node root">🎯 {blastRadius.name}</span>
                </div>
                
                {blastRadius.levels.map((level, levelIdx) => {
                  const folderGroups = groupByFolder(level.files);
                  
                  return (
                    <div key={levelIdx} className="tree-level">
                      <div className="tree-connector">
                        <span className="connector-line"></span>
                        <span className="level-label">Level {level.level} ({level.files.length} files)</span>
                      </div>
                      
                      <div className="folder-groups">
                        {folderGroups.map(([folder, files], folderIdx) => {
                          const folderKey = `${levelIdx}-${folder}`;
                          const isExpanded = expandedFolders[folderKey];
                          
                          return (
                            <div key={folderIdx} className="folder-group">
                              <button 
                                className={`folder-header ${isExpanded ? 'expanded' : ''}`}
                                onClick={() => toggleFolder(folderKey)}
                              >
                                <span className="folder-icon">{isExpanded ? '📂' : '📁'}</span>
                                <span className="folder-name">{folder}</span>
                                <span className="folder-count">{files.length} files</span>
                                <span className="folder-chevron">{isExpanded ? '▼' : '▶'}</span>
                              </button>
                              
                              {isExpanded && (
                                <div className="folder-files">
                                  {files.slice(0, 20).map((f, fileIdx) => (
                                    <button 
                                      key={fileIdx} 
                                      className="tree-node"
                                      onClick={() => { onClose(); onFileClick(f.file); }}
                                    >
                                      {f.name}
                                    </button>
                                  ))}
                                  {files.length > 20 && (
                                    <span className="folder-more">+{files.length - 20} more in this folder</span>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="blast-safe">
              <span className="safe-icon">🏝️</span>
              <h4>No Impact Detected</h4>
              <p>No other files depend on this file. It's safe to modify or remove.</p>
            </div>
          )}
        </div>
        
        <div className="blast-footer">
          <p className="blast-path">📁 {blastRadius.file}</p>
        </div>
      </div>
    </div>
  );
}

export default App;
