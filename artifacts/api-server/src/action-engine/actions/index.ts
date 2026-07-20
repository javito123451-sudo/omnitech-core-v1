/**
 * Action Engine — Action Loader
 *
 * Imports all action registration modules so their side-effects
 * (registerAction() calls) execute at startup.
 *
 * How to add new actions (Phase 4+):
 *  1. Create src/action-engine/actions/<domain>Actions.ts
 *  2. Call registerAction() for each action in that file.
 *  3. Import the file here (import "./timeActions" etc.)
 *
 * Domain-specific actions are intentionally NOT in builtins.ts —
 * each module owns its actions to keep concerns separated.
 */

import "./builtins";

// Phase 4+: domain action files will be imported here
// import "./timeActions";
// import "./crmActions";
// import "./accountingActions";
