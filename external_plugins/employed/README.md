# Employed by Guaq AI

[中文说明](./README_CN.md)

Live job search inside ZCode. Employed indexes job postings read directly from about 5,000 employers' own applicant-tracking systems (Greenhouse, Lever, Workday, Ashby, SmartRecruiters and more). Ask for roles by domain, seniority, location, work mode, technology or visa signal; open an employer's hiring profile; or get a short hiring-market brief. Every result links to the employer's own application page.

## What it adds

- **MCP server** `employed`: the hosted server at `https://jobs.guaqai.me/mcp` (Streamable HTTP). Search tools (`search_jobs`, `count_jobs`, `get_job`, `list_companies`, `company_profile`, `market_signal`, `api_meta`) and tools for the signed-in person's own Employed account (profile, ranked feed, application tracker, new-role alerts).
- **Skills**: `employed-jobs` (filter vocabulary and search workflow), `job-search-from-resume`, `employer-research`, `hiring-market-brief`, `application-tracker`.
- **Agents and commands**: `/find-jobs`, `/company`, `/market`.
- **Interactive results view**: search results render as an MCP Apps page (`ui://employed/results-v1`) in hosts that support it; elsewhere they arrive as ordinary tool results.

## Sign-in

The first time a tool runs, ZCode opens the Employed sign-in in the browser (OAuth 2.1 with dynamic client registration). A free Employed account is enough to start. No API key is pasted or stored by the plugin.

## Example prompts

- "Find entry-level backend roles in India."
- "Is Stripe hiring in London right now?"
- "Set up my Employed profile from this CV and show my best matches."

## Network access, data and side effects

- The only network destination is `https://jobs.guaqai.me/mcp`. It receives the search filters and ids the agent chooses, profile fields you ask it to save, and the OAuth token.
- Account tools change only your own Employed data (profile, tracker, alerts), and only when you ask. Nothing applies to jobs, contacts employers, or touches billing.
- The plugin has no hooks, runs no local commands, and writes no files in your workspace.
- Job-posting text is third-party content; the skills tell the agent to treat it as data, never as instructions.
- Visa sponsorship marked `likely` is an inference from posting text, not a guarantee.

## Links

- Website: https://jobs.guaqai.me
- Source: https://github.com/Guaq-AI/employed-plugins
- Privacy policy: https://jobs.guaqai.me/privacy-policy
- Terms: https://jobs.guaqai.me/terms-of-service
- Support: support@guaqai.me

## License

MIT. The hosted Employed service is operated by Guaq AI under its own terms.
