const sgMail = require("@sendgrid/mail");

if (process.env.SENDGRID_API_KEY) {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
}

const sendEmail = async (options) => {
  if (!process.env.SENDGRID_API_KEY) {
    console.warn("SENDGRID_API_KEY is not set. Email not sent.");
    return;
  }

  const msg = {
    to: options.email,
    from: process.env.SENDGRID_FROM_EMAIL,
    subject: options.subject,
    text: options.message,
    html: options.html,
  };

  try {
    await sgMail.send(msg);
    console.log("Email sent to " + options.email);
  } catch (error) {
    console.error("SendGrid Error:", error);
    if (error.response) {
      console.error(error.response.body);
    }
    throw new Error("Email could not be sent");
  }
};

module.exports = sendEmail;
