-- Kargo Hiring Dashboard — run once in Supabase → SQL Editor → New query → Run.

create table if not exists rubric_criteria (
  id serial primary key,
  role text not null check (role in ('PM','SPM')),
  position int not null,
  name text not null,
  description text not null,
  weight int not null,
  unique (role, position)
);

create table if not exists candidates (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  applied_role text not null check (applied_role in ('PM','SPM')),
  source_filename text,
  cv_content text not null,              -- redacted CV: no name / email / phone / profile links
  scores jsonb,                          -- {"PM":{"total":..,"criteria":[{name,weight,score,reason}]},"SPM":{...}}
  pm_score numeric,
  spm_score numeric,
  decision text check (decision in ('invite','reject')),
  decision_source text default 'system' check (decision_source in ('system','founder')),
  brief text,
  email_subject text,
  email_body text,                       -- contains [NAME]; real name substituted only at display/send
  draft_for text,                        -- which decision the current draft was written for
  status text not null default 'scored' check (status in ('scored','drafted','sent','error')),
  sent_at timestamptz,
  resend_id text,
  error text
);

-- Personal details live in their own table and are never sent to any AI step.
create table if not exists candidate_pii (
  candidate_id uuid primary key references candidates(id) on delete cascade,
  name text,
  email text,
  phone text
);

-- Lock everything down: only the server (service-role key) can read/write.
alter table rubric_criteria enable row level security;
alter table candidates enable row level security;
alter table candidate_pii enable row level security;

-- Rubric from rubric.txt
delete from rubric_criteria;
insert into rubric_criteria (role, position, name, description, weight) values
('PM',1,'Ground-level operations exposure','Has personally done operational work (shipment documentation, carrier coordination, dispatch, warehouse, customs, field ops or similar ops-heavy work) for 1+ years as a doer, not as a consultant or software builder. 5 = held an ops role in logistics/freight/supply chain handling real volume (numbers given). 3 = ops-heavy work in another industry, or worked on-site with operators for long stretches. 1 = only desk-side exposure (user interviews, APIs, analytics) or none.',25),
('PM',2,'Self-started fix that got adopted','The CV shows at least one problem they noticed without being asked, a fix they built themselves (tool, sheet, prototype, process), and evidence others adopted it (team size, time to adoption, kept permanently). 5 = two or more such cases with adoption numbers. 3 = one case, or initiative with no evidence of adoption. 1 = only work that was clearly assigned (shipped roadmap features, wrote requested docs).',25),
('PM',3,'Kills and owns failures in writing','Names something they killed, lost, or broke, what they learned, and what changed because of it (feature killed on data, post-mortem written, lost-deal analysis shared, bug escalated and owned). 5 = specific failure + written learning + changed practice. 3 = mentions iterating or pivoting without specifics. 1 = CV lists only wins.',20),
('PM',4,'Owns calls without a layer above','Has been the sole or final decision-maker for a product area, account, or process — no senior PM, manager, or committee making the call. 5 = explicitly sole owner with outcomes attributed to their decisions. 3 = owned features end-to-end inside a team with senior PMs above. 1 = supported others'' decisions.',15),
('PM',5,'Fixes under pressure','Describes a specific time-boxed crisis (outage, customs hold, vendor change, data loss risk, deadline) that they personally resolved, with the outcome. 5 = specific incident, their action, and a measurable result within hours/days. 3 = general on-call or escalation duty. 1 = no evidence.',15),
('SPM',1,'Ground-level operations exposure','Has personally done operational work as a doer. 5 requires 2+ years inside logistics/freight/supply-chain operations OR deep on-the-ground work with operators on integrations (carrier systems, port portals, ERPs). 3 = ops exposure in an adjacent industry. 1 = none / desk-side only.',20),
('SPM',2,'Self-started fix that got adopted','Noticed a problem unasked, built the fix themselves, and others adopted it. 5 requires a self-started initiative that became a platform-level or org-wide standard (adopted beyond their own team, or became a core product/feature). 3 = adopted only within their own team. 1 = only assigned work.',20),
('SPM',3,'Kills and owns failures in writing','Names something killed, lost or broken and what changed. 5 requires a costly call reversed or killed (feature, integration, vendor, deal) with a written post-mortem that changed how the wider team works. 3 = a smaller failure owned. 1 = only wins.',15),
('SPM',4,'Owns calls without a layer above','5 = for 2+ years was the top product/decision owner for an area (no senior PM above) and made consequential, hard-to-reverse calls (architecture, integrations, build vs buy, what not to build) and lived with the outcome. 3 = sole owner of an area for under 2 years, or senior owner with a Head of Product making the big calls. 1 = always had senior PMs/managers making the calls.',30),
('SPM',5,'Fixes under pressure','5 requires leading the response (not just participating) in a high-stakes incident affecting customers or revenue, with a measurable outcome and follow-up actions owned to closure. 3 = general on-call or escalation duty. 1 = no evidence.',15);
