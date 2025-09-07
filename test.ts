
const pattern = new URLPattern({pathname:"/(https?://.+)"});

console.log(pattern.exec("http://a/https://foo/bar/c%3Ftest"));
