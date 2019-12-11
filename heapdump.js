// cat > heapdump.js
// insert this

const heapdump = require('heapdump');
const filename = '/tmp/' + Date.now() + '.heapsnapshot';
heapdump.writeSnapshot(filename);
console.log('DONE')

// ctrl+D to save

// upload to transfer.sh
//  curl --upload-file  /tmp/xxx.heapsnapshot https://transfer.sh/memmory.heapsnapshot
// download file from transfer.sh
