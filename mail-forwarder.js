"use strict";

var AWS = require('aws-sdk');

function setMaps(){
  defaultConfig.forwardMapping = {};
  defaultConfig.forwardMapping[process.env.domain_email_name] = [process.env.to_email]
}

var defaultConfig = {
  fromEmail: process.env.domain_email_name,
  subjectPrefix: "",
  emailBucket: process.env.bucket_name,
  emailKeyPrefix: ""
};

exports.parseEvent = function(data) {
  // Validate characteristics of a SES event record.
  if (!data.event ||
      !data.event.hasOwnProperty('Records') ||
      data.event.Records.length !== 1 ||
      !data.event.Records[0].hasOwnProperty('eventSource') ||
      data.event.Records[0].eventSource !== 'aws:ses' ||
      data.event.Records[0].eventVersion !== '1.0') {
    data.log({message: "parseEvent() received invalid SES message:",
      level: "error", event: JSON.stringify(data.event)});
    return Promise.reject(new Error('Error: Received invalid SES message.'));
  }

  data.email = data.event.Records[0].ses.mail;
  data.recipients = data.event.Records[0].ses.receipt.recipients;
  return Promise.resolve(data);
};

exports.transformRecipients = function(data) {
  var newRecipients = [];
  data.originalRecipients = data.recipients;
  data.recipients.forEach(function(origEmail) {
    var origEmailKey = origEmail.toLowerCase();
    if (data.config.forwardMapping.hasOwnProperty(origEmailKey)) {
      newRecipients = newRecipients.concat(
        data.config.forwardMapping[origEmailKey]);
      data.originalRecipient = origEmail;
    } else {
      var origEmailDomain;
      var origEmailUser;
      var pos = origEmailKey.lastIndexOf("@");
      if (pos === -1) {
        origEmailUser = origEmailKey;
      } else {
        origEmailDomain = origEmailKey.slice(pos);
        origEmailUser = origEmailKey.slice(0, pos);
      }
      if (origEmailDomain &&
          data.config.forwardMapping.hasOwnProperty(origEmailDomain)) {
        newRecipients = newRecipients.concat(
          data.config.forwardMapping[origEmailDomain]);
        data.originalRecipient = origEmail;
      } else if (origEmailUser &&
        data.config.forwardMapping.hasOwnProperty(origEmailUser)) {
        newRecipients = newRecipients.concat(
          data.config.forwardMapping[origEmailUser]);
        data.originalRecipient = origEmail;
      }
    }
  });

  if (!newRecipients.length) {
    data.log({message: "Finishing process. No new recipients found for " +
      "original destinations: " + data.originalRecipients.join(", "),
      level: "info"});
    return data.callback();
  }

  data.recipients = newRecipients;
  return Promise.resolve(data);
};

exports.fetchMessage = function(data) {
  // Copying email object to ensure read permission
  return new Promise(function(resolve, reject) {
    data.s3.copyObject({
      Bucket: data.config.emailBucket,
      CopySource: data.config.emailBucket + '/' + data.config.emailKeyPrefix +
        data.email.messageId,
      Key: data.config.emailKeyPrefix + data.email.messageId,
      ACL: 'private',
      ContentType: 'text/plain',
      StorageClass: 'STANDARD'
    }, function(err) {
      if (err) {
        data.log({level: "error", message: "copyObject() returned error:",
          error: err, stack: err.stack});
        return reject(
          new Error("Error: Could not make readable copy of email."));
      }

      // Load the raw email from S3
      data.s3.getObject({
        Bucket: data.config.emailBucket,
        Key: data.config.emailKeyPrefix + data.email.messageId
      }, function(err, result) {
        if (err) {
          data.log({level: "error", message: "getObject() returned error:",
            error: err, stack: err.stack});
          return reject(
            new Error("Error: Failed to load message body from S3."));
        }
        data.emailData = result.Body.toString();
        return resolve(data);
      });
    });
  });
};

exports.processMessage = function(data) {
  var match = data.emailData.match(/^((?:.+\r?\n)*)(\r?\n(?:.*\s+)*)/m);
  var header = match && match[1] ? match[1] : data.emailData;
  var body = match && match[2] ? match[2] : '';

  // Add "Reply-To:" with the "From" address if it doesn't already exists
  if (!/^Reply-To: /mi.test(header)) {
    match = header.match(/^From: (.*(?:\r?\n\s+.*)*\r?\n)/m);
    var from = match && match[1] ? match[1] : '';
    if (from) {
      header = header + 'Reply-To: ' + from;
    }
  }

  // SES does not allow sending messages from an unverified address,
  // so replace the message's "From:" header with the original
  // recipient (which is a verified domain)
  header = header.replace(
    /^From: (.*(?:\r?\n\s+.*)*)/mg,
    function(match, from) {
      var fromText;
      if (data.config.fromEmail) {
        fromText = 'From: ' + from.replace(/<(.*)>/, '').trim() +
        ' <' + data.config.fromEmail + '>';
      } else {
        fromText = 'From: ' + from.replace('<', 'at ').replace('>', '') +
        ' <' + data.originalRecipient + '>';
      }
      return fromText;
    });

  // Add a prefix to the Subject
  if (data.config.subjectPrefix) {
    header = header.replace(
      /^Subject: (.*)/mg,
      function(match, subject) {
        return 'Subject: ' + data.config.subjectPrefix + subject;
      });
  }

  // Replace original 'To' header with a manually defined one
  if (data.config.toEmail) {
    header = header.replace(/^To: (.*)/mg, () => 'To: ' + data.config.toEmail);
  }

  // Remove the Return-Path header.
  header = header.replace(/^Return-Path: (.*)\r?\n/mg, '');

  // Remove Sender header.
  header = header.replace(/^Sender: (.*)\r?\n/mg, '');

  // Remove Message-ID header.
  header = header.replace(/^Message-ID: (.*)\r?\n/mig, '');

  // Remove all DKIM-Signature headers to prevent triggering an
  // "InvalidParameterValue: Duplicate header 'DKIM-Signature'" error.
  // These signatures will likely be invalid anyways, since the From
  // header was modified.
  header = header.replace(/^DKIM-Signature: .*\r?\n(\s+.*\r?\n)*/mg, '');

  data.emailData = header + body;
  return Promise.resolve(data);
};

exports.sendMessage = function(data) {
  var params = {
    Destinations: data.recipients,
    Source: data.originalRecipient,
    RawMessage: {
      Data: data.emailData
    }
  };
  return new Promise(function(resolve, reject) {
    data.ses.sendRawEmail(params, function(err, result) {
      if (err) {
        data.log({level: "error", message: "sendRawEmail() returned error.",
          error: err, stack: err.stack});
        return reject(new Error('Error: Email sending failed.'));
      }
      resolve(data);
    });
  });
};

exports.handler = function(event, context, callback, overrides) {
  setMaps();
  var steps = overrides && overrides.steps ? overrides.steps :
  [
    exports.parseEvent,
    exports.transformRecipients,
    exports.fetchMessage,
    exports.processMessage,
    exports.sendMessage
  ];
  var data = {
    event: event,
    callback: callback,
    context: context,
    config: overrides && overrides.config ? overrides.config : defaultConfig,
    log: overrides && overrides.log ? overrides.log : console.log,
    ses: overrides && overrides.ses ? overrides.ses : new AWS.SES(),
    s3: overrides && overrides.s3 ?
      overrides.s3 : new AWS.S3({signatureVersion: 'v4'})
  };
  Promise.series(steps, data)
    .then(function(data) {
      return data.callback();
    })
    .catch(function(err) {
      data.log({level: "error", message: "Step returned error: " + err.message,
        error: err, stack: err.stack});
      return data.callback(new Error("Error: Step returned error."));
    });
};

Promise.series = function(promises, initValue) {
  return promises.reduce(function(chain, promise) {
    if (typeof promise !== 'function') {
      return Promise.reject(new Error("Error: Invalid promise item: " +
        promise));
    }
    return chain.then(promise);
  }, Promise.resolve(initValue));
};
