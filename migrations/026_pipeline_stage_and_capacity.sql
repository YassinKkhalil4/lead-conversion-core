-- Pipeline stage and routing capacity.
--
-- `app.leads.status` stays exactly as it is. It carries the conversation
-- engine's own lifecycle (open / qualified / closed) and several services read
-- it, so a sales pipeline is added alongside it rather than overloading it.

ALTER TABLE app.leads
  ADD COLUMN IF NOT EXISTS pipeline_stage text NOT NULL DEFAULT 'new';

ALTER TABLE app.leads
  DROP CONSTRAINT IF EXISTS leads_pipeline_stage_check;

ALTER TABLE app.leads
  ADD CONSTRAINT leads_pipeline_stage_check
  CHECK (pipeline_stage IN (
    'new',
    'in_progress',
    'site_visit_scheduled',
    'closed_won',
    'closed_lost',
    'ghosted'
  ));

CREATE INDEX IF NOT EXISTS leads_client_pipeline_stage_idx
  ON app.leads (client_id, pipeline_stage);

-- How many active assignments one salesperson may hold before routing stops
-- sending them work. Per salesperson so a senior closer and a new joiner can
-- differ; defaults to 10 for every existing row.
ALTER TABLE app.salespeople
  ADD COLUMN IF NOT EXISTS capacity_limit integer NOT NULL DEFAULT 10;

ALTER TABLE app.salespeople
  DROP CONSTRAINT IF EXISTS salespeople_capacity_limit_check;

ALTER TABLE app.salespeople
  ADD CONSTRAINT salespeople_capacity_limit_check
  CHECK (capacity_limit > 0);
