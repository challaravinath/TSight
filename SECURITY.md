# Security

TSight reads source code on your machine, and the server can clone public repositories, so security reports matter.

## Reporting a problem

Please don't open a public issue for a security problem. Use GitHub's private reporting instead: on the repository page, open the Security tab and choose "Report a vulnerability". Include what you found, how to reproduce it, and what someone could do with it.

I'll reply as soon as I can, usually within a week. Once a fix is released, you'll be credited in the changelog if you'd like to be.

## Supported versions

Only the latest release gets security fixes.

## How TSight limits what it can reach

- The server listens on 127.0.0.1 by default and checks the Host header, so other machines and web pages can't reach it.
- Only plain `https://github.com/owner/repo` URLs can be cloned.
- With `TSIGHT_WORKSPACE_ROOT` set, only folders inside it can be analyzed.
- Reports embed the analysis as escaped JSON, so project content can't run as script.
- TSight never runs the code it analyzes.
