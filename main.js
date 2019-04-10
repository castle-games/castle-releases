const fs = require('fs');
const request = require('request');
const child_process = require('child_process');

// Utility function to cleanup directories
const cleanup = (dirname) => {
  // Collect modification days (as milliseconds from epoch) per file
  const filenames = fs.readdirSync(dirname);
  const daysAndPaths = filenames.map((filename) => {
    const path = `${dirname}/${filename}`;
    const date = new Date(
      child_process
        .execSync(`git log -1 --format="%ad" -- ${path}`)
        .toString()
        .trim()
    );
    const day = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
    return { day, path };
  });

  // Collect sorted list of unique modification days
  const days = daysAndPaths.map((dayAndPath) => dayAndPath.day);
  const sortedDays = days.sort((a, b) => a < b ? 1 : a > b ? -1 : 0);
  const sortedUniqueDays = [];
  sortedDays.forEach((day) => {
    if (sortedUniqueDays.length == 0 || sortedUniqueDays[sortedUniqueDays.length - 1] !== day) {
      sortedUniqueDays.push(day);
    }
  });

  // Collect 10 most recent modification days
  const recentUpdateDays = sortedUniqueDays.slice(0, 10);

  // Delete all files that weren't one of the last 10 updates
  daysAndPaths.forEach(({ day, path }) => {
    if (!recentUpdateDays.includes(day)) {
      fs.unlinkSync(path);
    }
  });
};

// Make sure the tree is clean
// console.log('Making sure tree is clean...');
// if (child_process.execSync('git diff HEAD').length !== 0) {
//   console.log('Tree is dirty, aborting...');
//   process.exit(1);
// }

// Read the Castle server auth token
let token = process.env['CASTLE_UPLOAD_TOKEN'];
// if (!token) {
//   const tokenFilename =
//     process.env['DOWNLOADSECUREFILE_SECUREFILEPATH'] || '../../../ghost-secret/ci-secret-file.txt';
//   token = fs.readFileSync(tokenFilename, 'utf8');
// }

const arg = process.argv[2];

// Example macOS usage:
//   node main.js mac ../Castle-1.20.zip
if (arg === 'mac') {
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

  // Cleanup
  cleanup('mac');

  // Make and push a commit
  console.log('Committing...');
  child_process.execSync('git add -u mac/');
  child_process.execSync(
    `git -c "user.name=castle-circleci-access" -c "user.email=services@castle.games" commit -m "mac: release '${zipName}'"`
  );
  console.log('Pushing...');
  child_process.execSync('git push origin master');
  const commit = child_process
    .execSync('git rev-parse HEAD')
    .toString()
    .trim();

  // Let our server know a new release exists
  console.log('Updating release tag on Castle server...');
  request.post(
    {
      url: 'https://api.castle.games/api/releases/set-tag',
      headers: {
        'X-Auth-Token': token,
      },
      qs: {
        platform: 'mac',
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

// Example Windows usage:
//   node main.js win ../build/Release 1.20 ../extra/castle.ico
if (arg == 'win') {
  const releaseDirPath = process.argv[3].replace('/', '\\');
  const versionName = process.argv[4];
  const iconPath = process.argv[5].replace('/', '\\');
  if (!releaseDirPath || !versionName || !iconPath) {
    console.log('Not enough parameters!');
    process.exit(0);
  }

  // Make our '.exe' 'Squirrel-aware'
  console.log("Making 'Castle.exe' 'Squirrel-aware'...");
  child_process.execSync(
    `.\\Squirrel-bin\\rcedit.exe ${releaseDirPath}\\Castle.exe --set-version-string SquirrelAwareVersion 1`
  );

  // Create '.nupkg'
  console.log(`Creating '.nupkg'...`);
  fs.writeFileSync(
    'Castle.nuspec',
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
</package>`
  );
  child_process.execSync(
    `.\\Squirrel-bin\\nuget.exe pack -BasePath ${releaseDirPath} -NoDefaultExcludes`,
    { stdio: 'inherit' }
  );
  fs.unlinkSync('Castle.nuspec');
  const nupkgPath = `Castle.0.${versionName}.nupkg`;

  // Releasify with Squirrel
  console.log(`'Releasifying' with Squirrel...`);
  child_process.execSync(
    `.\\Squirrel-bin\\Squirrel.exe --releasify ${nupkgPath} --releaseDir win --icon ${iconPath} --setupIcon ${iconPath} --no-msi`,
    { stdio: 'inherit' }
  );
  const setupName = `Castle-${versionName}-Setup.exe`;
  const setupPath = `win/${setupName}`;
  fs.renameSync('win/Setup.exe', setupPath);
  fs.unlinkSync(`Castle.0.${versionName}.nupkg`);

  // Cleanup
  cleanup('mac');

  // Make and push a commit
  console.log('Committing...');
  child_process.execSync('git add -u win/');
  child_process.execSync(
    `git -c "user.name=castle-circleci-access" -c "user.email=services@castle.games" commit -m "win: release '${setupName}'"`
  );
  console.log('Pushing...');
  child_process.execSync('git push origin master');
  const commit = child_process
    .execSync('git rev-parse HEAD')
    .toString()
    .trim();

  // Let our server know a new release exists
  console.log('Updating release tag on Castle server...');
  request.post(
    {
      url: 'https://api.castle.games/api/releases/set-tag',
      headers: {
        'X-Auth-Token': token,
      },
      qs: {
        platform: 'win',
        tag: commit,
        'installer-filename': setupPath,
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

if (arg == 'cleanup') {
  cleanup('mac');
  cleanup('win');
}
