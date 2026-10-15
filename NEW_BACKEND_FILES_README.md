LocalPro1 — New Chat Backend Files
=================================

Create these files at the exact paths shown:

1. backend/middleware/chatAuthorization.js
   Previously provided as chatAuthorization.txt / chatAuthorization.js.
   Checks conversation-level access. Mount after the existing `protect` middleware.

2. backend/services/chatSocketService.js
   Previously provided as chatSocketService.txt / chatSocketService.js.
   Socket helper functions for room membership and emitting events.

3. backend/services/chatNotificationService.js
   Previously provided as chatNotificationService.txt / chatNotificationService.js.
   Creates chat notifications and can emit them to a recipient's private room.

4. backend/sockets/events.js
   Previously provided as events.txt / events.js.
   Central list of socket event names.

5. backend/sockets/socketManager.js
   Previously provided as socketManager.txt / socketManager.js.
   Registers the Socket.IO server and provides room-emitting helpers.

6. backend/services/socketService.js
   New in this batch. Reusable wrappers around socketManager and events.js.

7. backend/middleware/uploadMiddleware.js
   New in this batch. Multer upload configuration with file count, file size,
   extension and MIME allowlists.

IMPORTANT INTEGRATION / SECURITY NOTES
======================================

- These files are not automatically wired into existing controllers or server.js.
  Integrate them deliberately to avoid duplicate socket handlers and duplicate
  notification delivery.
- `socketManager.setSocketServer(io)` must be called once during startup before
  any socketService emit helper is used.
- `uploadChatAttachments` must be mounted after authentication/authorization.
  Do not make uploaded chat files publicly accessible unless that is intended.
- Extension and MIME checks are not a substitute for inspecting file contents.
  For production, consider magic-byte validation and malware scanning.
- Uploaded files need an authorization-checked download route. Do not expose
  backend/uploads/chat as a public static directory.
- Verify the actual Notification, Conversation and Message schemas and the
  installed Mongoose/Socket.IO/Multer versions before integration.
- No live database, socket integration, or upload security tests were run here.
