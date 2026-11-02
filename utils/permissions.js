const permissions = {
  admin: [
    "dashboard:view",
    "users:view",
    "users:create",
    "users:update",
    "users:block",
    "tasks:view",
    "tasks:create",
    "tasks:assign",
    "tasks:update",
    "tasks:delete",
    "tasks:approve",
    "attendance:view",
    "attendance:manage",
    "reports:view",
    "notifications:view",
    "devices:view",
    "devices:manage",
    "profile:view",
    "profile:update",
    "settings:view",
    "settings:update",
  ],

  manager: [
    "dashboard:view",
    "users:view",
    "tasks:view",
    "tasks:create",
    "tasks:assign",
    "tasks:update",
    "tasks:approve",
    "attendance:view",
    "attendance:manage",
    "reports:view",
    "notifications:view",
    "devices:view",
    "profile:view",
    "profile:update",
  ],

  user: [
    "dashboard:view",
    "tasks:view",
    "attendance:view",
    "attendance:checkin",
    "attendance:checkout",
    "notifications:view",
    "profile:view",
    "profile:update",
    "settings:view",
  ],
};

export const getPermissions = (role) => {
  return permissions[role] ? [...permissions[role]] : [];
};

export const hasPermission = (role, permission) => {
  return getPermissions(role).includes(permission);
};

export default permissions;