const fs = require('fs');
const request = require('request');
const child_process = require('child_process');

// Make sure the tree is clean
// console.log('Making sure tree is clean...');
// if (child_process.execSync('git diff HEAD').length !== 0) {
//   console.log('Tree is dirty, aborting...');
//   process.exit(1);
// }

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
    function (err, resp, body) {
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

if (platform == 'win') {
  const releaseDirPath = process.argv[3];
  const versionName = process.argv[4];
  if (!releaseDirPath || !versionName) {
    console.log('Not enough parameters!');
    process.exit(0);
  }

  // Create '.nupkg'
  fs.writeFileSync('Castle.nuspec',
    `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://schemas.microsoft.com/packaging/2010/07/nuspec.xsd">
  <metadata>
    <id>Castle</id>
    <title>Castle</title>
    <version>0.${versionName}</version>
    <authors>http://castle.games</authors>
    <owners>http://castle.games</owners>
    <description>Castle</description>
  </metadata>
  <files>
    <file src="**" target="lib\\net45\\" />
  </files>
</package>`);
  child_process.execSync(`./Squirrel-bin/nuget.exe pack -BasePath ${releaseDirPath} -NoDefaultExcludes`, { stdio: 'inherit' });
  fs.unlinkSync('Castle.nuspec');
  const nupkgPath = `Castle.0.${versionName}.nupkg`;

  // Releasify with Squirrel
  child_process.execSync(`./Squirrel-bin/Squirrel.exe --releasify ${nupkgPath} --releaseDir win/ --no-msi`, { stdio: 'inherit' });
  fs.renameSync('win/Setup.exe', `win/Castle-${versionName}-Setup.exe`);
}