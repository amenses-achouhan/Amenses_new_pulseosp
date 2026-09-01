/**
 * Centralized permission definitions for PulseOps RBAC.
 *
 * Roles are resolved by `verifyTenantAccess` (from the active workspace
 * OrganizationMember) and exposed on `req.userRole`. Route guards use
 * the `requirePermission` middleware (see ../middleware/requirePermission.js):
 *
 *   router.get('/x', authenticate, verifyTenantAccess, requirePermission('view_projects'), handler)
 *
 * Role hierarchy & capabilities:
 *  - owner: full control, non-restrictable.
 *  - admin / maintainer: operational power, no destructive/ownership actions.
 *  - developer: development & task execution, read-only on project metadata/reports.
 *  - viewer: read-only everywhere, zero write access.
 */

const PERMISSIONS = [
  'manage_workspace',
  'manage_members',
  'invite_members',
  'view_team',
  'manage_integrations',
  'view_integrations',
  'view_developers',
  'manage_projects',
  'view_projects',
  'manage_repositories',
  'view_repositories',
  'view_communication',
  'generate_reports',
  'view_reports',
  'view_analytics',
  'manage_tasks',
  'view_tasks',
  'manage_tickets',
  'view_tickets',
];

const ROLE_PERMISSIONS = {
  // Workspace owner — full control, cannot be restricted.
  owner: [
    'manage_workspace',
    'manage_members',
    'invite_members',
    'view_team',
    'manage_integrations',
    'view_integrations',
    'view_developers',    'manage_projects',
    'view_projects',
    'manage_repositories',
    'view_repositories',
    'view_communication',
    'generate_reports',
    'view_reports',
    'view_analytics',
    'manage_tasks',
    'view_tasks',
    'manage_tickets',
    'view_tickets',
  ],


  // Full workspace administration (operational power, no destructive/ownership actions).
  admin: [
    'manage_members',
    'invite_members',
    'view_team',
    'manage_integrations',
    'view_integrations',
    'view_developers',
    'manage_projects',
    'view_projects',
    'manage_repositories',
    'view_repositories',
    'view_communication',
    'generate_reports',
    'view_reports',
    'view_analytics',
    'manage_tasks',
    'view_tasks',
    'manage_tickets',
    'view_tickets',
  ],

  // Operational maintainer (equivalent operational scope to admin without owner power).
  maintainer: [
    'manage_members',
    'invite_members',
    'view_team',
    'manage_integrations',
    'view_integrations',
    'view_developers',
    'manage_projects',
    'view_projects',
    'manage_repositories',
    'view_repositories',
    'view_communication',
    'generate_reports',
    'view_reports',
    'view_analytics',
    'manage_tasks',
    'view_tasks',
    'manage_tickets',
    'view_tickets',
  ],

  // Development / work execution.
  developer: [
    'manage_integrations',
    'view_integrations',
    'view_projects',
    'view_repositories',
    'view_communication',
    'view_reports',
    'view_analytics',
    'manage_tasks',
    'view_tasks',
    'manage_tickets',
    'view_tickets',
  ],

  // Read-only everywhere, zero write access.
  viewer: [
    'view_repositories',
    'view_communication',
    'view_reports',
    'view_analytics',
    'view_tasks',
    'view_tickets',
  ],
};

/**
 * Returns true when the given role is granted `permission`.
 * Unknown roles and unknown permissions return false (fail closed).
 */
const hasPermission = (role, permission) => {
  if (!role || typeof role !== 'string') return false;
  const perms = ROLE_PERMISSIONS[role.toLowerCase()];
  return Array.isArray(perms) && perms.includes(permission);
};

module.exports = { PERMISSIONS, ROLE_PERMISSIONS, hasPermission };
