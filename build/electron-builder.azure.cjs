// electron-builder 26.x overlay. Only public account identifiers belong here/in these variables.
// Azure authentication remains in the signing process's environment, outside the app package.
const base = require('../package.json').build;
function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}. Configure your verified signing account first.`);
  return value;
}
module.exports = {
  ...base,
  forceCodeSigning: true,
  publish: null,
  win: {
    ...base.win,
    azureSignOptions: {
      publisherName: required('ISSUE_SCOUT_SIGNING_PUBLISHER'),
      endpoint: required('ISSUE_SCOUT_SIGNING_ENDPOINT'),
      codeSigningAccountName: required('ISSUE_SCOUT_SIGNING_ACCOUNT'),
      certificateProfileName: required('ISSUE_SCOUT_SIGNING_PROFILE'),
      fileDigest: 'SHA256',
      timestampDigest: 'SHA256',
    },
  },
};
