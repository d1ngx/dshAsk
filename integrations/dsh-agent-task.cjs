'use strict';
/** Call after fetching context and verifying the authenticated DSH request user. */
function prepareAgentTask(context, authenticatedUserId, availableCapabilities) {
  if (!context || !authenticatedUserId || String(context.userID) !== String(authenticatedUserId)) {
    throw new Error('KodBox task user mismatch');
  }
  if (!context.agentTask) return null; // Existing Q&A sessions stay unchanged.
  const task = context.agentTask;
  if (task.schemaVersion !== 1 || !task.agent || typeof task.prompt !== 'string' ||
      !Array.isArray(task.agent.requires) || !Array.isArray(context.files)) {
    throw new Error('Unsupported KodBox agent task');
  }
  const available = new Set(availableCapabilities || []);
  const missing = task.agent.requires.filter(name => !available.has(name));
  if (missing.length) throw new Error('Missing Office capabilities: ' + missing.join(', '));
  // Return a session-scoped task. Do not put task state in a shared per-user global.
  // Never place accessToken into a model prompt, browser response, or log.
  return {
    agentId: task.agent.id,
    agentVersion: task.agent.version,
    prompt: task.prompt,
    files: context.files,
    currentPath: context.currentPath,
    outputFormat: task.outputFormat,
    style: task.style,
    policy: task.policy
  };
}
module.exports = { prepareAgentTask };
