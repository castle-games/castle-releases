const fs = require('fs');
const request = require('request');
const child_process = require('child_process');

// Make sure the tree is clean
console.log('Making sure tree is clean...');
if (child_process.execSync('git diff HEAD').length !== 0) {
  console.log('Tree is dirty, aborting...');
  process.exit(1);
}

// Read the Castle server auth token
let token = process.env['CASTLE_UPLOAD_TOKEN'];
if (!token) {
  const tokenFilename =
    process.env['DOWNLOADSECUREFILE_SECUREFILEPATH'] || '../../../ghost-secret/ci-secret-file.txt';
  token = fs.readFileSync(tokenFilename, 'utf8');
}

const platform = process.argv[2];

if (platform === 'mac') {
  // Move the '.zip' into 'mac/'
  const zipPath = process.argv[3];
  const zipName = zipPath.match('[^/]*$')[0];
  const zipDest = `mac/${zipName}`;
  if (fs.existsSync(zipDest)) {
    console.log(`'${zipDest}' already exists! Version name should be new. Aborting...`);
    process.exit(1);
  }
  console.log(`Moving '${zipPath}' to '${zipDest}'...`);
  fs.renameSync(zipPath, zipDest);

  // Update 'appcast.xml' and generate '.delta's
  console.log(`Generating 'mac/appcast.xml'...`);
  child_process.execSync('./Sparkle-bin/generate_appcast mac/');

  // Make and push a commit
  console.log('Committing...');
  child_process.execSync('git add mac/*');
  child_process.execSync(`git -c "user.name=castle-circleci-access" -c "user.email=services@castle.games" commit -m "mac: release '${zipName}'"`);
  console.log('Pushing...');
  child_process.execSync('git push origin master');
  const commit = child_process.execSync('git rev-parse HEAD').toString().trim();

  // Let our server know a new release exists
  console.log('Updating release tag on Castle server...');
  request.post(
    {
      url: 'https://api.castle.games/api/releases/set-tag',
      headers: {
        'X-Auth-Token': token,
      },
      qs: {
        platform: process.argv[2],
        tag: commit,
        'installer-filename': zipDest,
      },
    },
    function(err, resp, body) {
      if (err || resp.statusCode !== 200) {
        console.log('Error! ' + resp.body);
        process.exit(1);
      } else {
        console.log('Success!');
        process.exit(0);
      }
    }
  );
}

if (platform === 'win') {
  const dirPath = process.argv[3];
  const version = process.argv[4];
  const iconPath = process.argv[5];
  if (!dirPath || !version || !iconPath) {
    console.log('Usage: castle-releases win <release-dir-path> <version-name> <icon-path>');
    process.exit(0);
  }

  process.platform = 'win32';
  const electronInstaller = require('electron-winstaller');
  try {
    electronInstaller.createWindowsInstaller({
      appDirectory: dirPath,
      outputDirectory: 'win/',
      authors: 'http://castle.games',
      exe: 'Castle.exe',
      description: 'Castle',
      version,
      title: 'Castle',
      name: 'Castle',

      iconUrl: iconPath,
      setupIcon: iconPath,
      setupExe: `Castle-${version}.exe`,
      noMsi: true,
    });
    console.log('Success!');
  } catch (e) {
    console.log('Error creating installer: ' + e.message);
    process.exit(0);
  }
}