## AMap footprint

`footprint-amap/` uses the [AMap (高德) Open Platform](https://console.amap.com/)
JavaScript API 2.0.

### Setup

1. In the [AMap console](https://console.amap.com/), create an application and
   add a key with the **Web端 (JS API)** service platform
   ([guide](https://lbs.amap.com/api/javascript-api-v2/prerequisites)).
2. Put the key and its security code in `footprint-amap/amap-config.js`.
3. In the key settings, add the domain whitelist: `localhost` / `127.0.0.1`
   for development and the production domain for the published site.

### Local development

From the repository root, run `python3 -m http.server 8000`, then open
`http://localhost:8000/hy/footprint-amap/`.

### Notes

- The key and security code are committed and visible in the browser. Access is
  restricted by the domain whitelist, so keep it limited to the domains above.
- AMap's GPS coordinate conversion only supports coordinates in China; overseas
  points are drawn as-is.
