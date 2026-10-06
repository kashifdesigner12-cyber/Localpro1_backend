const nodemailer = require("nodemailer");

// =====================================================
// EMAIL TRANSPORTER
// =====================================================

const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 465,
  secure: true,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

// =====================================================
// VERIFY EMAIL CONNECTION
// =====================================================

transporter.verify((error, success) => {
  if (error) {
    console.error(
      "❌ Email Transporter Error:",
      error.message
    );
  } else {
    console.log(
      "✅ Email Server is ready to send messages"
    );
  }
});

// =====================================================
// 1. WELCOME EMAIL
// =====================================================

const sendWelcomeEmail = async (
  targetUserEmail,
  targetUserName,
  rawPassword
) => {
  try {
    const loginUrl =
      process.env.FRONTEND_LOGIN_URL ||
      "http://localhost:3000/login";

    const mailOptions = {
      from: `"LocalPro Team" <${process.env.EMAIL_USER}>`,
      to: targetUserEmail,
      subject:
        "Welcome to LocalPro - Your Account Credentials",

      html: `
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8">
          <meta
            name="viewport"
            content="width=device-width, initial-scale=1.0"
          >
        </head>

        <body
          style="
            margin: 0;
            padding: 0;
            background-color: #f4f7fa;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI',
              Roboto, Helvetica, Arial, sans-serif;
          "
        >

          <table
            border="0"
            cellpadding="0"
            cellspacing="0"
            width="100%"
            style="padding: 40px 0;"
          >
            <tr>
              <td align="center">

                <table
                  border="0"
                  cellpadding="0"
                  cellspacing="0"
                  width="100%"
                  style="
                    max-width: 600px;
                    background-color: #ffffff;
                    border-radius: 12px;
                    overflow: hidden;
                    border: 1px solid #e2e8f0;
                  "
                >

                  <tr>
                    <td
                      style="
                        background: linear-gradient(
                          135deg,
                          #1e293b 0%,
                          #0f172a 100%
                        );
                        padding: 36px 40px;
                        text-align: center;
                      "
                    >
                      <h1
                        style="
                          color: #ffffff;
                          margin: 0;
                          font-size: 24px;
                        "
                      >
                        LocalPro Portal
                      </h1>

                      <p
                        style="
                          color: #94a3b8;
                          margin: 8px 0 0 0;
                          font-size: 14px;
                        "
                      >
                        Welcome to the team
                      </p>
                    </td>
                  </tr>

                  <tr>
                    <td style="padding: 36px 40px 24px 40px;">

                      <h2
                        style="
                          color: #0f172a;
                          margin: 0 0 16px 0;
                          font-size: 20px;
                        "
                      >
                        Hello, ${targetUserName}!
                      </h2>

                      <p
                        style="
                          color: #475569;
                          font-size: 15px;
                          line-height: 1.6;
                          margin: 0 0 24px 0;
                        "
                      >
                        Your account has been created successfully.
                        You can now access your dashboard using
                        the credentials below:
                      </p>

                      <table
                        border="0"
                        cellpadding="0"
                        cellspacing="0"
                        width="100%"
                        style="
                          background-color: #f8fafc;
                          border: 1px solid #e2e8f0;
                          border-radius: 8px;
                          margin-bottom: 28px;
                        "
                      >
                        <tr>
                          <td style="padding: 20px;">

                            <table
                              border="0"
                              cellpadding="0"
                              cellspacing="0"
                              width="100%"
                            >

                              <tr>
                                <td
                                  style="
                                    padding: 6px 0;
                                    color: #64748b;
                                    font-size: 14px;
                                    width: 140px;
                                  "
                                >
                                  <strong>Email:</strong>
                                </td>

                                <td
                                  style="
                                    padding: 6px 0;
                                    color: #0f172a;
                                    font-size: 14px;
                                    font-weight: 500;
                                  "
                                >
                                  ${targetUserEmail}
                                </td>
                              </tr>

                              <tr>
                                <td
                                  style="
                                    padding: 6px 0;
                                    color: #64748b;
                                    font-size: 14px;
                                  "
                                >
                                  <strong>Password:</strong>
                                </td>

                                <td
                                  style="
                                    padding: 6px 0;
                                    font-size: 14px;
                                  "
                                >
                                  <code
                                    style="
                                      background-color: #e2e8f0;
                                      color: #2563eb;
                                      padding: 3px 8px;
                                      border-radius: 4px;
                                      font-size: 14px;
                                      font-weight: 600;
                                    "
                                  >
                                    ${rawPassword}
                                  </code>
                                </td>
                              </tr>

                            </table>

                          </td>
                        </tr>
                      </table>

                      <div
                        style="
                          text-align: center;
                          margin-bottom: 30px;
                        "
                      >
                        <a
                          href="${loginUrl}"
                          target="_blank"
                          rel="noopener noreferrer"
                          style="
                            background-color: #2563eb;
                            color: #ffffff;
                            padding: 14px 32px;
                            font-size: 15px;
                            font-weight: 600;
                            text-decoration: none;
                            border-radius: 8px;
                            display: inline-block;
                          "
                        >
                          Sign In to Your Account
                        </a>
                      </div>

                    </td>
                  </tr>

                </table>

              </td>
            </tr>
          </table>

        </body>
        </html>
      `,
    };

    const info =
      await transporter.sendMail(mailOptions);

    console.log(
      "✅ Welcome email sent:",
      targetUserEmail
    );

    return info;
  } catch (err) {
    console.error(
      "❌ SendWelcomeEmail failed:",
      err
    );

    throw err;
  }
};

// =====================================================
// 2. NEW MESSAGE NOTIFICATION EMAIL
// =====================================================

const sendMessageNotificationEmail = async (
  targetUserEmail,
  targetUserName,
  senderName,
  messageText
) => {
  try {
    const portalUrl =
      process.env.FRONTEND_APP_URL ||
      process.env.FRONTEND_LOGIN_URL ||
      "http://localhost:3000";

    const mailOptions = {
      from: `"LocalPro Portal" <${process.env.EMAIL_USER}>`,
      to: targetUserEmail,
      subject: `New Message from ${senderName} - LocalPro`,

      html: `
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8">
          <meta
            name="viewport"
            content="width=device-width, initial-scale=1.0"
          >
        </head>

        <body
          style="
            margin: 0;
            padding: 0;
            background-color: #f4f7fa;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI',
              Roboto, Helvetica, Arial, sans-serif;
          "
        >

          <table
            border="0"
            cellpadding="0"
            cellspacing="0"
            width="100%"
            style="padding: 40px 0;"
          >
            <tr>
              <td align="center">

                <table
                  border="0"
                  cellpadding="0"
                  cellspacing="0"
                  width="100%"
                  style="
                    max-width: 600px;
                    background-color: #ffffff;
                    border-radius: 12px;
                    overflow: hidden;
                    border: 1px solid #e2e8f0;
                  "
                >

                  <tr>
                    <td
                      style="
                        background: linear-gradient(
                          135deg,
                          #1e293b 0%,
                          #0f172a 100%
                        );
                        padding: 30px 40px;
                        text-align: center;
                      "
                    >
                      <h1
                        style="
                          color: #ffffff;
                          margin: 0;
                          font-size: 22px;
                        "
                      >
                        New Direct Message
                      </h1>
                    </td>
                  </tr>

                  <tr>
                    <td style="padding: 36px 40px 24px 40px;">

                      <h2
                        style="
                          color: #0f172a;
                          margin: 0 0 12px 0;
                          font-size: 18px;
                        "
                      >
                        Hello ${targetUserName},
                      </h2>

                      <p
                        style="
                          color: #475569;
                          font-size: 15px;
                          margin: 0 0 20px 0;
                        "
                      >
                        You have received a new message from
                        <strong>${senderName}</strong>:
                      </p>

                      <div
                        style="
                          background-color: #f8fafc;
                          border-left: 4px solid #2563eb;
                          padding: 16px 20px;
                          border-radius: 4px;
                          margin-bottom: 26px;
                        "
                      >
                        <p
                          style="
                            color: #1e293b;
                            font-size: 15px;
                            font-style: italic;
                            margin: 0;
                            line-height: 1.5;
                          "
                        >
                          "${messageText}"
                        </p>
                      </div>

                      <div
                        style="
                          text-align: center;
                          margin-bottom: 25px;
                        "
                      >
                        <a
                          href="${portalUrl}"
                          target="_blank"
                          rel="noopener noreferrer"
                          style="
                            background-color: #2563eb;
                            color: #ffffff;
                            padding: 12px 28px;
                            font-size: 14px;
                            font-weight: 600;
                            text-decoration: none;
                            border-radius: 6px;
                            display: inline-block;
                          "
                        >
                          Open Chat & Reply
                        </a>
                      </div>

                    </td>
                  </tr>

                </table>

              </td>
            </tr>
          </table>

        </body>
        </html>
      `,
    };

    const info =
      await transporter.sendMail(mailOptions);

    console.log(
      "✅ Message notification email sent to:",
      targetUserEmail
    );

    return info;
  } catch (err) {
    console.error(
      "❌ SendMessageNotificationEmail failed:",
      err
    );

    throw err;
  }
};

// =====================================================
// 3. TASK ASSIGNMENT NOTIFICATION EMAIL
// =====================================================

const sendTaskAssignedEmail = async (
  targetUserEmail,
  targetUserName,
  assignerName,
  taskTitle,
  taskDescription,
  dueDate
) => {
  try {
    const portalUrl =
      process.env.FRONTEND_APP_URL ||
      process.env.FRONTEND_LOGIN_URL ||
      "http://localhost:3000";

    const mailOptions = {
      from: `"LocalPro Tasks" <${process.env.EMAIL_USER}>`,
      to: targetUserEmail,
      subject: `New Task Assigned: ${taskTitle}`,

      html: `
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8">
          <meta
            name="viewport"
            content="width=device-width, initial-scale=1.0"
          >
        </head>

        <body
          style="
            margin: 0;
            padding: 0;
            background-color: #f4f7fa;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI',
              Roboto, Helvetica, Arial, sans-serif;
          "
        >

          <table
            border="0"
            cellpadding="0"
            cellspacing="0"
            width="100%"
            style="padding: 40px 0;"
          >
            <tr>
              <td align="center">

                <table
                  border="0"
                  cellpadding="0"
                  cellspacing="0"
                  width="100%"
                  style="
                    max-width: 600px;
                    background-color: #ffffff;
                    border-radius: 12px;
                    overflow: hidden;
                    border: 1px solid #e2e8f0;
                  "
                >

                  <tr>
                    <td
                      style="
                        background: linear-gradient(
                          135deg,
                          #0284c7 0%,
                          #0369a1 100%
                        );
                        padding: 30px 40px;
                        text-align: center;
                      "
                    >
                      <h1
                        style="
                          color: #ffffff;
                          margin: 0;
                          font-size: 22px;
                        "
                      >
                        New Task Assigned
                      </h1>
                    </td>
                  </tr>

                  <tr>
                    <td style="padding: 36px 40px 24px 40px;">

                      <h2
                        style="
                          color: #0f172a;
                          margin: 0 0 12px 0;
                          font-size: 18px;
                        "
                      >
                        Hello ${targetUserName},
                      </h2>

                      <p
                        style="
                          color: #475569;
                          font-size: 15px;
                          margin: 0 0 20px 0;
                        "
                      >
                        <strong>${assignerName}</strong>
                        has assigned a new task to you.
                      </p>

                      <div
                        style="
                          background-color: #f8fafc;
                          border: 1px solid #e2e8f0;
                          border-radius: 8px;
                          padding: 20px;
                          margin-bottom: 26px;
                        "
                      >

                        <h3
                          style="
                            color: #0f172a;
                            margin: 0 0 10px 0;
                            font-size: 16px;
                          "
                        >
                          ${taskTitle}
                        </h3>

                        ${
                          taskDescription
                            ? `
                              <p
                                style="
                                  color: #475569;
                                  font-size: 14px;
                                  margin: 0 0 12px 0;
                                  line-height: 1.5;
                                "
                              >
                                ${taskDescription}
                              </p>
                            `
                            : ""
                        }

                        ${
                          dueDate
                            ? `
                              <p
                                style="
                                  color: #e11d48;
                                  font-size: 13px;
                                  font-weight: 600;
                                  margin: 0;
                                "
                              >
                                Due Date:
                                ${new Date(
                                  dueDate
                                ).toLocaleDateString()}
                              </p>
                            `
                            : ""
                        }

                      </div>

                      <div
                        style="
                          text-align: center;
                          margin-bottom: 25px;
                        "
                      >
                        <a
                          href="${portalUrl}"
                          target="_blank"
                          rel="noopener noreferrer"
                          style="
                            background-color: #0284c7;
                            color: #ffffff;
                            padding: 12px 28px;
                            font-size: 14px;
                            font-weight: 600;
                            text-decoration: none;
                            border-radius: 6px;
                            display: inline-block;
                          "
                        >
                          View Task in Dashboard
                        </a>
                      </div>

                    </td>
                  </tr>

                </table>

              </td>
            </tr>
          </table>

        </body>
        </html>
      `,
    };

    const info =
      await transporter.sendMail(mailOptions);

    console.log(
      "✅ Task assigned email sent to:",
      targetUserEmail
    );

    return info;
  } catch (err) {
    console.error(
      "❌ SendTaskAssignedEmail failed:",
      err
    );

    throw err;
  }
};

// =====================================================
// 4. TASK COMPLETED NOTIFICATION EMAIL
// =====================================================

const sendTaskCompletedEmail = async (
  creatorEmail,
  creatorName,
  completedByName,
  taskTitle,
  completedAt
) => {
  try {
    const portalUrl =
      process.env.FRONTEND_APP_URL ||
      process.env.FRONTEND_LOGIN_URL ||
      "http://localhost:3000";

    const mailOptions = {
      from: `"LocalPro Tasks" <${process.env.EMAIL_USER}>`,
      to: creatorEmail,
      subject: `Task Completed: ${taskTitle}`,

      html: `
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8">
          <meta
            name="viewport"
            content="width=device-width, initial-scale=1.0"
          >
        </head>

        <body
          style="
            margin: 0;
            padding: 0;
            background-color: #f4f7fa;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI',
              Roboto, Helvetica, Arial, sans-serif;
          "
        >

          <table
            border="0"
            cellpadding="0"
            cellspacing="0"
            width="100%"
            style="padding: 40px 0;"
          >
            <tr>
              <td align="center">

                <table
                  border="0"
                  cellpadding="0"
                  cellspacing="0"
                  width="100%"
                  style="
                    max-width: 600px;
                    background-color: #ffffff;
                    border-radius: 12px;
                    overflow: hidden;
                    border: 1px solid #e2e8f0;
                  "
                >

                  <tr>
                    <td
                      style="
                        background: linear-gradient(
                          135deg,
                          #10b981 0%,
                          #059669 100%
                        );
                        padding: 30px 40px;
                        text-align: center;
                      "
                    >
                      <h1
                        style="
                          color: #ffffff;
                          margin: 0;
                          font-size: 22px;
                        "
                      >
                        Task Marked as Completed
                      </h1>
                    </td>
                  </tr>

                  <tr>
                    <td style="padding: 36px 40px 24px 40px;">

                      <h2
                        style="
                          color: #0f172a;
                          margin: 0 0 12px 0;
                          font-size: 18px;
                        "
                      >
                        Hello ${creatorName},
                      </h2>

                      <p
                        style="
                          color: #475569;
                          font-size: 15px;
                          margin: 0 0 20px 0;
                        "
                      >
                        <strong>${completedByName}</strong>
                        has successfully completed the assigned task.
                      </p>

                      <div
                        style="
                          background-color: #f0fdf4;
                          border: 1px solid #bbf7d0;
                          border-radius: 8px;
                          padding: 20px;
                          margin-bottom: 26px;
                        "
                      >

                        <h3
                          style="
                            color: #166534;
                            margin: 0 0 8px 0;
                            font-size: 16px;
                          "
                        >
                          ${taskTitle}
                        </h3>

                        <p
                          style="
                            color: #15803d;
                            font-size: 13px;
                            font-weight: 600;
                            margin: 0;
                          "
                        >
                          Status: Completed
                        </p>

                        <p
                          style="
                            color: #64748b;
                            font-size: 13px;
                            margin: 6px 0 0 0;
                          "
                        >
                          Completed Date:
                          ${new Date(
                            completedAt || Date.now()
                          ).toLocaleString()}
                        </p>

                      </div>

                      <div
                        style="
                          text-align: center;
                          margin-bottom: 25px;
                        "
                      >
                        <a
                          href="${portalUrl}"
                          target="_blank"
                          rel="noopener noreferrer"
                          style="
                            background-color: #10b981;
                            color: #ffffff;
                            padding: 12px 28px;
                            font-size: 14px;
                            font-weight: 600;
                            text-decoration: none;
                            border-radius: 6px;
                            display: inline-block;
                          "
                        >
                          Review Completed Task
                        </a>
                      </div>

                    </td>
                  </tr>

                </table>

              </td>
            </tr>
          </table>

        </body>
        </html>
      `,
    };

    const info =
      await transporter.sendMail(mailOptions);

    console.log(
      "✅ Task completed email sent to:",
      creatorEmail
    );

    return info;
  } catch (err) {
    console.error(
      "❌ SendTaskCompletedEmail failed:",
      err
    );

    throw err;
  }
};

// =====================================================
// 5. DAILY ATTENDANCE REMINDER EMAIL
// =====================================================

const sendAttendanceReminderEmail = async (
  targetUserEmail,
  targetUserName
) => {
  try {
    const attendanceUrl =
      "http://localpro1.net/user/attendance";

    const mailOptions = {
      from: `"LocalPro Portal" <${process.env.EMAIL_USER}>`,
      to: targetUserEmail,
      subject: "Mark Your Attendance - LocalPro",

      html: `
        <!DOCTYPE html>
        <html lang="en">

        <head>
          <meta charset="UTF-8">

          <meta
            name="viewport"
            content="width=device-width, initial-scale=1.0"
          >

          <title>Mark Your Attendance</title>
        </head>

        <body
          style="
            margin: 0;
            padding: 0;
            background-color: #f4f7fa;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI',
              Roboto, Helvetica, Arial, sans-serif;
          "
        >

          <table
            border="0"
            cellpadding="0"
            cellspacing="0"
            width="100%"
            style="padding: 40px 0;"
          >

            <tr>

              <td align="center">

                <table
                  border="0"
                  cellpadding="0"
                  cellspacing="0"
                  width="100%"
                  style="
                    max-width: 600px;
                    background-color: #ffffff;
                    border-radius: 12px;
                    overflow: hidden;
                    border: 1px solid #e2e8f0;
                  "
                >

                  <!-- HEADER -->

                  <tr>

                    <td
                      style="
                        background: linear-gradient(
                          135deg,
                          #1e293b 0%,
                          #0f172a 100%
                        );
                        padding: 32px 40px;
                        text-align: center;
                      "
                    >

                      <h1
                        style="
                          color: #ffffff;
                          margin: 0;
                          font-size: 24px;
                        "
                      >
                        LocalPro Portal
                      </h1>

                      <p
                        style="
                          color: #94a3b8;
                          margin: 8px 0 0 0;
                          font-size: 14px;
                        "
                      >
                        Attendance Reminder
                      </p>

                    </td>

                  </tr>

                  <!-- CONTENT -->

                  <tr>

                    <td
                      style="
                        padding: 36px 40px 30px 40px;
                      "
                    >

                      <h2
                        style="
                          color: #0f172a;
                          margin: 0 0 16px 0;
                          font-size: 20px;
                        "
                      >
                        Hello ${targetUserName || "there"},
                      </h2>

                      <p
                        style="
                          color: #475569;
                          font-size: 15px;
                          line-height: 1.6;
                          margin: 0 0 26px 0;
                        "
                      >
                        Please mark your attendance for today.
                        Click the button below to open your
                        attendance page and mark your attendance.
                      </p>

                      <!-- BUTTON -->

                      <div
                        style="
                          text-align: center;
                          margin-bottom: 28px;
                        "
                      >

                        <a
                          href="${attendanceUrl}"
                          target="_blank"
                          rel="noopener noreferrer"
                          style="
                            background-color: #2563eb;
                            color: #ffffff;
                            padding: 14px 32px;
                            font-size: 15px;
                            font-weight: 600;
                            text-decoration: none;
                            border-radius: 8px;
                            display: inline-block;
                          "
                        >
                          Mark Your Attendance
                        </a>

                      </div>

                      <p
                        style="
                          color: #64748b;
                          font-size: 13px;
                          line-height: 1.5;
                          margin: 0;
                          text-align: center;
                        "
                      >
                        Attendance can only be marked from
                        the allowed office location.
                      </p>

                    </td>

                  </tr>

                </table>

              </td>

            </tr>

          </table>

        </body>

        </html>
      `,
    };

    const info =
      await transporter.sendMail(mailOptions);

    console.log(
      "✅ Attendance reminder email sent to:",
      targetUserEmail
    );

    return info;
  } catch (err) {
    console.error(
      "❌ SendAttendanceReminderEmail failed:",
      err
    );

    throw err;
  }
};

// =====================================================
// 6. LEAVE REQUEST EMAIL TO ADMIN
// =====================================================

const sendLeaveRequestEmailToAdmin = async (
  adminEmail,
  userName,
  userEmail,
  leaveType,
  startDate,
  endDate,
  reason
) => {
  try {
    const leaveRequestsUrl =
      "http://localpro1.net/admin/leave-requests";

    const mailOptions = {
      from: `"LocalPro Portal" <${process.env.EMAIL_USER}>`,
      to: adminEmail,
      subject: `New Leave Request - ${userName || "User"}`,

      html: `
        <!DOCTYPE html>
        <html lang="en">

        <head>
          <meta charset="UTF-8">

          <meta
            name="viewport"
            content="width=device-width, initial-scale=1.0"
          >

          <title>New Leave Request</title>
        </head>

        <body
          style="
            margin: 0;
            padding: 0;
            background-color: #f4f7fa;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI',
              Roboto, Helvetica, Arial, sans-serif;
          "
        >

          <table
            border="0"
            cellpadding="0"
            cellspacing="0"
            width="100%"
            style="padding: 40px 0;"
          >

            <tr>

              <td align="center">

                <table
                  border="0"
                  cellpadding="0"
                  cellspacing="0"
                  width="100%"
                  style="
                    max-width: 600px;
                    background-color: #ffffff;
                    border-radius: 12px;
                    overflow: hidden;
                    border: 1px solid #e2e8f0;
                  "
                >

                  <!-- HEADER -->

                  <tr>

                    <td
                      style="
                        background: linear-gradient(
                          135deg,
                          #1e293b 0%,
                          #0f172a 100%
                        );
                        padding: 32px 40px;
                        text-align: center;
                      "
                    >

                      <h1
                        style="
                          color: #ffffff;
                          margin: 0;
                          font-size: 24px;
                        "
                      >
                        LocalPro Portal
                      </h1>

                      <p
                        style="
                          color: #94a3b8;
                          margin: 8px 0 0 0;
                          font-size: 14px;
                        "
                      >
                        New Leave Request
                      </p>

                    </td>

                  </tr>

                  <!-- CONTENT -->

                  <tr>

                    <td
                      style="
                        padding: 36px 40px 30px 40px;
                      "
                    >

                      <h2
                        style="
                          color: #0f172a;
                          margin: 0 0 16px 0;
                          font-size: 20px;
                        "
                      >
                        New Leave Request Submitted
                      </h2>

                      <p
                        style="
                          color: #475569;
                          font-size: 15px;
                          line-height: 1.6;
                          margin: 0 0 24px 0;
                        "
                      >
                        ${userName || "A user"} has submitted a new
                        leave request. Please review the details below.
                      </p>

                      <!-- LEAVE DETAILS -->

                      <table
                        border="0"
                        cellpadding="0"
                        cellspacing="0"
                        width="100%"
                        style="
                          background-color: #f8fafc;
                          border: 1px solid #e2e8f0;
                          border-radius: 8px;
                          margin-bottom: 28px;
                        "
                      >

                        <tr>
                          <td
                            style="
                              padding: 12px 16px;
                              color: #64748b;
                              font-size: 14px;
                              font-weight: 600;
                              width: 35%;
                            "
                          >
                            User
                          </td>

                          <td
                            style="
                              padding: 12px 16px;
                              color: #0f172a;
                              font-size: 14px;
                            "
                          >
                            ${userName || "N/A"}
                          </td>
                        </tr>

                        <tr>
                          <td
                            style="
                              padding: 12px 16px;
                              color: #64748b;
                              font-size: 14px;
                              font-weight: 600;
                            "
                          >
                            Email
                          </td>

                          <td
                            style="
                              padding: 12px 16px;
                              color: #0f172a;
                              font-size: 14px;
                            "
                          >
                            ${userEmail || "N/A"}
                          </td>
                        </tr>

                        <tr>
                          <td
                            style="
                              padding: 12px 16px;
                              color: #64748b;
                              font-size: 14px;
                              font-weight: 600;
                            "
                          >
                            Leave Type
                          </td>

                          <td
                            style="
                              padding: 12px 16px;
                              color: #0f172a;
                              font-size: 14px;
                            "
                          >
                            ${leaveType || "N/A"}
                          </td>
                        </tr>

                        <tr>
                          <td
                            style="
                              padding: 12px 16px;
                              color: #64748b;
                              font-size: 14px;
                              font-weight: 600;
                            "
                          >
                            Start Date
                          </td>

                          <td
                            style="
                              padding: 12px 16px;
                              color: #0f172a;
                              font-size: 14px;
                            "
                          >
                            ${startDate || "N/A"}
                          </td>
                        </tr>

                        <tr>
                          <td
                            style="
                              padding: 12px 16px;
                              color: #64748b;
                              font-size: 14px;
                              font-weight: 600;
                            "
                          >
                            End Date
                          </td>

                          <td
                            style="
                              padding: 12px 16px;
                              color: #0f172a;
                              font-size: 14px;
                            "
                          >
                            ${endDate || "N/A"}
                          </td>
                        </tr>

                        <tr>
                          <td
                            style="
                              padding: 12px 16px;
                              color: #64748b;
                              font-size: 14px;
                              font-weight: 600;
                              vertical-align: top;
                            "
                          >
                            Reason
                          </td>

                          <td
                            style="
                              padding: 12px 16px;
                              color: #0f172a;
                              font-size: 14px;
                              line-height: 1.5;
                            "
                          >
                            ${reason || "N/A"}
                          </td>
                        </tr>

                      </table>

                      <!-- BUTTON -->

                      <div
                        style="
                          text-align: center;
                          margin-bottom: 28px;
                        "
                      >

                        <a
                          href="${leaveRequestsUrl}"
                          target="_blank"
                          rel="noopener noreferrer"
                          style="
                            background-color: #2563eb;
                            color: #ffffff;
                            padding: 14px 32px;
                            font-size: 15px;
                            font-weight: 600;
                            text-decoration: none;
                            border-radius: 8px;
                            display: inline-block;
                          "
                        >
                          View Leave Requests
                        </a>

                      </div>

                      <p
                        style="
                          color: #64748b;
                          font-size: 13px;
                          line-height: 1.5;
                          margin: 0;
                          text-align: center;
                        "
                      >
                        Please review the request and approve or
                        reject it from the Leave Requests page.
                      </p>

                    </td>

                  </tr>

                </table>

              </td>

            </tr>

          </table>

        </body>

        </html>
      `,
    };

    const info =
      await transporter.sendMail(mailOptions);

    console.log(
      "✅ Leave request email sent to admin:",
      adminEmail
    );

    return info;
  } catch (err) {
    console.error(
      "❌ SendLeaveRequestEmailToAdmin failed:",
      err
    );

    throw err;
  }
};

// =====================================================
// EXPORTS
// =====================================================

module.exports = {
  sendWelcomeEmail,
  sendMessageNotificationEmail,
  sendTaskAssignedEmail,
  sendTaskCompletedEmail,
  sendAttendanceReminderEmail,
  sendLeaveRequestEmailToAdmin,
};