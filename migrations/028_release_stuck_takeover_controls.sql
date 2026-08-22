-- Release control rows stuck in a takeover that can no longer be lifted.
--
-- `edge_lead_controls.current_stage` used to be written with
-- COALESCE(NULLIF(EXCLUDED.current_stage,''), old), so once it reached
-- 'human_takeover' no later snapshot could move it back — the value only ever
-- changed to another non-empty stage. A released takeover therefore left
-- human_takeover=false alongside current_stage='human_takeover', and the engine
-- kept suppressing on the stage alone.
--
-- Rows where the flag says "not taken over" but the stage says "taken over" are
-- unambiguously in that stuck state, so the stage is cleared. Rows with
-- human_takeover=true are a live operator decision and are left untouched.
UPDATE edge_lead_controls
SET current_stage = '',
    control_version = control_version + 1,
    updated_at = now()
WHERE current_stage = 'human_takeover'
  AND human_takeover = false;

-- The same stuck pair can exist on conversations that were suppressed by the
-- inherited stage. Only conversations whose flag is already false are touched.
UPDATE edge_conversations
SET current_stage = '',
    state_version = state_version + 1,
    updated_at = now()
WHERE current_stage = 'human_takeover'
  AND human_takeover = false;
