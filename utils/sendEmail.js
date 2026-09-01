const nodemailer = require("nodemailer");

// Transporter with exact host & port configuration
const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 465,
  secure: true,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

// Verify connection on startup
transporter.verify((error, success) => {
  if (error) {
    console.error("❌ Email Transporter Error:", error.message);
  } else {
    console.log("✅ Email Server is ready to send messages");
  }
});

/**
 * 1. Welcome Email (Existing)
 */
const sendWelcomeEmail = async (targetUserEmail, targetUserName, rawPassword) => {
  try {
    const loginUrl = process.env.FRONTEND_LOGIN_URL || "http://localhost:3000/login";

    const mailOptions = {
      from: `"LocalPro Team" <${process.env.EMAIL_USER}>`,
      to: targetUserEmail,
      subject: "Welcome to LocalPro - Your Account Credentials",
      html: `
        <!DOCTYPE html>
        <html lang="en">
        <head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
        <body style="margin: 0; padding: 0; background-color: #f4f7fa; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
          <table border="0" cellpadding="0" cellspacing="0" width="100%" style="padding: 40px 0;">
            <tr>
              <td align="center">
                <table border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 600px; background-color: #ffffff; border-radius: 12px; overflow: hidden; border: 1px solid #e2e8f0;">
                  <tr>
                    <td style="background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%); padding: 36px 40px; text-align: center;">
                      <h1 style="color: #ffffff; margin: 0; font-size: 24px;">LocalPro Portal</h1>
                      <p style="color: #94a3b8; margin: 8px 0 0 0; font-size: 14px;">Welcome to the team</p>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding: 36px 40px 24px 40px;">
                      <h2 style="color: #0f172a; margin: 0 0 16px 0; font-size: 20px;">Hello, ${targetUserName}!</h2>
                      <p style="color: #475569; font-size: 15px; line-height: 1.6; margin: 0 0 24px 0;">
                        Your account has been created successfully. You can now access your dashboard using the credentials below:
                      </p>
                      <table border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; margin-bottom: 28px;">
                        <tr>
                          <td style="padding: 20px;">
                            <table border="0" cellpadding="0" cellspacing="0" width="100%">
                              <tr>
                                <td style="padding: 6px 0; color: #64748b; font-size: 14px; width: 140px;"><strong>Email:</strong></td>
                                <td style="padding: 6px 0; color: #0f172a; font-size: 14px; font-weight: 500;">${targetUserEmail}</td>
                              </tr>
                              <tr>
                                <td style="padding: 6px 0; color: #64748b; font-size: 14px;"><strong>Password:</strong></td>
                                <td style="padding: 6px 0; font-size: 14px;">
                                  <code style="background-color: #e2e8f0; color: #2563eb; padding: 3px 8px; border-radius: 4px; font-size: 14px; font-weight: 600;">${rawPassword}</code>
                                </td>
                              </tr>
                            </table>
                          </td>
                        </tr>
                      </table>
                      <div style="text-align: center; margin-bottom: 30px;">
                        <a href="${loginUrl}" target="_blank" style="background-color: #2563eb; color: #ffffff; padding: 14px 32px; font-size: 15px; font-weight: 600; text-decoration: none; border-radius: 8px; display: inline-block;">
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

    const info = await transporter.sendMail(mailOptions);
    console.log("✅ Welcome email sent:", targetUserEmail);
    return info;
  } catch (err) {
    console.error("❌ SendWelcomeEmail failed:", err);
    throw err;
  }
};

/**
 * 2. New Message Notification Email
 */
const sendMessageNotificationEmail = async (targetUserEmail, targetUserName, senderName, messageText) => {
  try {
    const portalUrl = process.env.FRONTEND_APP_URL || process.env.FRONTEND_LOGIN_URL || "http://localhost:3000";

    const mailOptions = {
      from: `"LocalPro Portal" <${process.env.EMAIL_USER}>`,
      to: targetUserEmail,
      subject: `New Message from ${senderName} - LocalPro`,
      html: `
        <!DOCTYPE html>
        <html lang="en">
        <head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
        <body style="margin: 0; padding: 0; background-color: #f4f7fa; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
          <table border="0" cellpadding="0" cellspacing="0" width="100%" style="padding: 40px 0;">
            <tr>
              <td align="center">
                <table border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 600px; background-color: #ffffff; border-radius: 12px; overflow: hidden; border: 1px solid #e2e8f0;">
                  <tr>
                    <td style="background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%); padding: 30px 40px; text-align: center;">
                      <h1 style="color: #ffffff; margin: 0; font-size: 22px;">New Direct Message</h1>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding: 36px 40px 24px 40px;">
                      <h2 style="color: #0f172a; margin: 0 0 12px 0; font-size: 18px;">Hello ${targetUserName},</h2>
                      <p style="color: #475569; font-size: 15px; margin: 0 0 20px 0;">
                        You have received a new message from <strong>${senderName}</strong>:
                      </p>
                      
                      <div style="background-color: #f8fafc; border-left: 4px solid #2563eb; padding: 16px 20px; border-radius: 4px; margin-bottom: 26px;">
                        <p style="color: #1e293b; font-size: 15px; font-style: italic; margin: 0; line-height: 1.5;">"${messageText}"</p>
                      </div>

                      <div style="text-align: center; margin-bottom: 25px;">
                        <a href="${portalUrl}" target="_blank" style="background-color: #2563eb; color: #ffffff; padding: 12px 28px; font-size: 14px; font-weight: 600; text-decoration: none; border-radius: 6px; display: inline-block;">
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

    const info = await transporter.sendMail(mailOptions);
    console.log("✅ Message notification email sent to:", targetUserEmail);
    return info;
  } catch (err) {
    console.error("❌ SendMessageNotificationEmail failed:", err);
    throw err;
  }
};

/**
 * 3. Task Assignment Notification Email
 */
const sendTaskAssignedEmail = async (targetUserEmail, targetUserName, assignerName, taskTitle, taskDescription, dueDate) => {
  try {
    const portalUrl = process.env.FRONTEND_APP_URL || process.env.FRONTEND_LOGIN_URL || "http://localhost:3000";

    const mailOptions = {
      from: `"LocalPro Tasks" <${process.env.EMAIL_USER}>`,
      to: targetUserEmail,
      subject: `New Task Assigned: ${taskTitle}`,
      html: `
        <!DOCTYPE html>
        <html lang="en">
        <head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
        <body style="margin: 0; padding: 0; background-color: #f4f7fa; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
          <table border="0" cellpadding="0" cellspacing="0" width="100%" style="padding: 40px 0;">
            <tr>
              <td align="center">
                <table border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 600px; background-color: #ffffff; border-radius: 12px; overflow: hidden; border: 1px solid #e2e8f0;">
                  <tr>
                    <td style="background: linear-gradient(135deg, #0284c7 0%, #0369a1 100%); padding: 30px 40px; text-align: center;">
                      <h1 style="color: #ffffff; margin: 0; font-size: 22px;">New Task Assigned</h1>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding: 36px 40px 24px 40px;">
                      <h2 style="color: #0f172a; margin: 0 0 12px 0; font-size: 18px;">Hello ${targetUserName},</h2>
                      <p style="color: #475569; font-size: 15px; margin: 0 0 20px 0;">
                        <strong>${assignerName}</strong> has assigned a new task to you.
                      </p>
                      
                      <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 20px; margin-bottom: 26px;">
                        <h3 style="color: #0f172a; margin: 0 0 10px 0; font-size: 16px;">${taskTitle}</h3>
                        ${taskDescription ? `<p style="color: #475569; font-size: 14px; margin: 0 0 12px 0; line-height: 1.5;">${taskDescription}</p>` : ""}
                        ${dueDate ? `<p style="color: #e11d48; font-size: 13px; font-weight: 600; margin: 0;">Due Date: ${new Date(dueDate).toLocaleDateString()}</p>` : ""}
                      </div>

                      <div style="text-align: center; margin-bottom: 25px;">
                        <a href="${portalUrl}" target="_blank" style="background-color: #0284c7; color: #ffffff; padding: 12px 28px; font-size: 14px; font-weight: 600; text-decoration: none; border-radius: 6px; display: inline-block;">
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

    const info = await transporter.sendMail(mailOptions);
    console.log("✅ Task assigned email sent to:", targetUserEmail);
    return info;
  } catch (err) {
    console.error("❌ SendTaskAssignedEmail failed:", err);
    throw err;
  }
};

module.exports = {
  sendWelcomeEmail,
  sendMessageNotificationEmail,
  sendTaskAssignedEmail,
};