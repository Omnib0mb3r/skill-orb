diff --git a/03-vscode-extension/package-lock.json b/03-vscode-extension/package-lock.json
index 3b50baa..2b36ebb 100644
--- a/03-vscode-extension/package-lock.json
+++ b/03-vscode-extension/package-lock.json
@@ -14,12 +14,14 @@
         "ws": "^8.16.0"
       },
       "devDependencies": {
+        "@types/jsdom": "^28.0.1",
         "@types/node": "^20.0.0",
         "@types/three": "^0.183.1",
         "@types/vscode": "^1.85.0",
         "@types/ws": "^8.5.0",
         "@vscode/vsce": "^2.23.0",
         "esbuild": "^0.20.0",
+        "jsdom": "^29.0.1",
         "typescript": "^5.3.0",
         "vitest": "^1.0.0"
       },
@@ -27,6 +29,67 @@
         "vscode": "^1.85.0"
       }
     },
+    "node_modules/@asamuzakjp/css-color": {
+      "version": "5.1.1",
+      "resolved": "https://registry.npmjs.org/@asamuzakjp/css-color/-/css-color-5.1.1.tgz",
+      "integrity": "sha512-iGWN8E45Ws0XWx3D44Q1t6vX2LqhCKcwfmwBYCDsFrYFS6m4q/Ks61L2veETaLv+ckDC6+dTETJoaAAb7VjLiw==",
+      "dev": true,
+      "license": "MIT",
+      "dependencies": {
+        "@csstools/css-calc": "^3.1.1",
+        "@csstools/css-color-parser": "^4.0.2",
+        "@csstools/css-parser-algorithms": "^4.0.0",
+        "@csstools/css-tokenizer": "^4.0.0",
+        "lru-cache": "^11.2.7"
+      },
+      "engines": {
+        "node": "^20.19.0 || ^22.12.0 || >=24.0.0"
+      }
+    },
+    "node_modules/@asamuzakjp/css-color/node_modules/lru-cache": {
+      "version": "11.2.7",
+      "resolved": "https://registry.npmjs.org/lru-cache/-/lru-cache-11.2.7.tgz",
+      "integrity": "sha512-aY/R+aEsRelme17KGQa/1ZSIpLpNYYrhcrepKTZgE+W3WM16YMCaPwOHLHsmopZHELU0Ojin1lPVxKR0MihncA==",
+      "dev": true,
+      "license": "BlueOak-1.0.0",
+      "engines": {
+        "node": "20 || >=22"
+      }
+    },
+    "node_modules/@asamuzakjp/dom-selector": {
+      "version": "7.0.4",
+      "resolved": "https://registry.npmjs.org/@asamuzakjp/dom-selector/-/dom-selector-7.0.4.tgz",
+      "integrity": "sha512-jXR6x4AcT3eIrS2fSNAwJpwirOkGcd+E7F7CP3zjdTqz9B/2huHOL8YJZBgekKwLML+u7qB/6P1LXQuMScsx0w==",
+      "dev": true,
+      "license": "MIT",
+      "dependencies": {
+        "@asamuzakjp/nwsapi": "^2.3.9",
+        "bidi-js": "^1.0.3",
+        "css-tree": "^3.2.1",
+        "is-potential-custom-element-name": "^1.0.1",
+        "lru-cache": "^11.2.7"
+      },
+      "engines": {
+        "node": "^20.19.0 || ^22.12.0 || >=24.0.0"
+      }
+    },
+    "node_modules/@asamuzakjp/dom-selector/node_modules/lru-cache": {
+      "version": "11.2.7",
+      "resolved": "https://registry.npmjs.org/lru-cache/-/lru-cache-11.2.7.tgz",
+      "integrity": "sha512-aY/R+aEsRelme17KGQa/1ZSIpLpNYYrhcrepKTZgE+W3WM16YMCaPwOHLHsmopZHELU0Ojin1lPVxKR0MihncA==",
+      "dev": true,
+      "license": "BlueOak-1.0.0",
+      "engines": {
+        "node": "20 || >=22"
+      }
+    },
+    "node_modules/@asamuzakjp/nwsapi": {
+      "version": "2.3.9",
+      "resolved": "https://registry.npmjs.org/@asamuzakjp/nwsapi/-/nwsapi-2.3.9.tgz",
+      "integrity": "sha512-n8GuYSrI9bF7FFZ/SjhwevlHc8xaVlb/7HmHelnc/PZXBD2ZR49NnN9sMMuDdEGPeeRQ5d0hqlSlEpgCX3Wl0Q==",
+      "dev": true,
+      "license": "MIT"
+    },
     "node_modules/@azure/abort-controller": {
       "version": "2.1.2",
       "resolved": "https://registry.npmjs.org/@azure/abort-controller/-/abort-controller-2.1.2.tgz",
@@ -196,6 +259,159 @@
         "node": ">=20"
       }
     },
+    "node_modules/@bramus/specificity": {
+      "version": "2.4.2",
+      "resolved": "https://registry.npmjs.org/@bramus/specificity/-/specificity-2.4.2.tgz",
+      "integrity": "sha512-ctxtJ/eA+t+6q2++vj5j7FYX3nRu311q1wfYH3xjlLOsczhlhxAg2FWNUXhpGvAw3BWo1xBcvOV6/YLc2r5FJw==",
+      "dev": true,
+      "license": "MIT",
+      "dependencies": {
+        "css-tree": "^3.0.0"
+      },
+      "bin": {
+        "specificity": "bin/cli.js"
+      }
+    },
+    "node_modules/@csstools/color-helpers": {
+      "version": "6.0.2",
+      "resolved": "https://registry.npmjs.org/@csstools/color-helpers/-/color-helpers-6.0.2.tgz",
+      "integrity": "sha512-LMGQLS9EuADloEFkcTBR3BwV/CGHV7zyDxVRtVDTwdI2Ca4it0CCVTT9wCkxSgokjE5Ho41hEPgb8OEUwoXr6Q==",
+      "dev": true,
+      "funding": [
+        {
+          "type": "github",
+          "url": "https://github.com/sponsors/csstools"
+        },
+        {
+          "type": "opencollective",
+          "url": "https://opencollective.com/csstools"
+        }
+      ],
+      "license": "MIT-0",
+      "engines": {
+        "node": ">=20.19.0"
+      }
+    },
+    "node_modules/@csstools/css-calc": {
+      "version": "3.1.1",
+      "resolved": "https://registry.npmjs.org/@csstools/css-calc/-/css-calc-3.1.1.tgz",
+      "integrity": "sha512-HJ26Z/vmsZQqs/o3a6bgKslXGFAungXGbinULZO3eMsOyNJHeBBZfup5FiZInOghgoM4Hwnmw+OgbJCNg1wwUQ==",
+      "dev": true,
+      "funding": [
+        {
+          "type": "github",
+          "url": "https://github.com/sponsors/csstools"
+        },
+        {
+          "type": "opencollective",
+          "url": "https://opencollective.com/csstools"
+        }
+      ],
+      "license": "MIT",
+      "engines": {
+        "node": ">=20.19.0"
+      },
+      "peerDependencies": {
+        "@csstools/css-parser-algorithms": "^4.0.0",
+        "@csstools/css-tokenizer": "^4.0.0"
+      }
+    },
+    "node_modules/@csstools/css-color-parser": {
+      "version": "4.0.2",
+      "resolved": "https://registry.npmjs.org/@csstools/css-color-parser/-/css-color-parser-4.0.2.tgz",
+      "integrity": "sha512-0GEfbBLmTFf0dJlpsNU7zwxRIH0/BGEMuXLTCvFYxuL1tNhqzTbtnFICyJLTNK4a+RechKP75e7w42ClXSnJQw==",
+      "dev": true,
+      "funding": [
+        {
+          "type": "github",
+          "url": "https://github.com/sponsors/csstools"
+        },
+        {
+          "type": "opencollective",
+          "url": "https://opencollective.com/csstools"
+        }
+      ],
+      "license": "MIT",
+      "dependencies": {
+        "@csstools/color-helpers": "^6.0.2",
+        "@csstools/css-calc": "^3.1.1"
+      },
+      "engines": {
+        "node": ">=20.19.0"
+      },
+      "peerDependencies": {
+        "@csstools/css-parser-algorithms": "^4.0.0",
+        "@csstools/css-tokenizer": "^4.0.0"
+      }
+    },
+    "node_modules/@csstools/css-parser-algorithms": {
+      "version": "4.0.0",
+      "resolved": "https://registry.npmjs.org/@csstools/css-parser-algorithms/-/css-parser-algorithms-4.0.0.tgz",
+      "integrity": "sha512-+B87qS7fIG3L5h3qwJ/IFbjoVoOe/bpOdh9hAjXbvx0o8ImEmUsGXN0inFOnk2ChCFgqkkGFQ+TpM5rbhkKe4w==",
+      "dev": true,
+      "funding": [
+        {
+          "type": "github",
+          "url": "https://github.com/sponsors/csstools"
+        },
+        {
+          "type": "opencollective",
+          "url": "https://opencollective.com/csstools"
+        }
+      ],
+      "license": "MIT",
+      "engines": {
+        "node": ">=20.19.0"
+      },
+      "peerDependencies": {
+        "@csstools/css-tokenizer": "^4.0.0"
+      }
+    },
+    "node_modules/@csstools/css-syntax-patches-for-csstree": {
+      "version": "1.1.2",
+      "resolved": "https://registry.npmjs.org/@csstools/css-syntax-patches-for-csstree/-/css-syntax-patches-for-csstree-1.1.2.tgz",
+      "integrity": "sha512-5GkLzz4prTIpoyeUiIu3iV6CSG3Plo7xRVOFPKI7FVEJ3mZ0A8SwK0XU3Gl7xAkiQ+mDyam+NNp875/C5y+jSA==",
+      "dev": true,
+      "funding": [
+        {
+          "type": "github",
+          "url": "https://github.com/sponsors/csstools"
+        },
+        {
+          "type": "opencollective",
+          "url": "https://opencollective.com/csstools"
+        }
+      ],
+      "license": "MIT-0",
+      "peerDependencies": {
+        "css-tree": "^3.2.1"
+      },
+      "peerDependenciesMeta": {
+        "css-tree": {
+          "optional": true
+        }
+      }
+    },
+    "node_modules/@csstools/css-tokenizer": {
+      "version": "4.0.0",
+      "resolved": "https://registry.npmjs.org/@csstools/css-tokenizer/-/css-tokenizer-4.0.0.tgz",
+      "integrity": "sha512-QxULHAm7cNu72w97JUNCBFODFaXpbDg+dP8b/oWFAZ2MTRppA3U00Y2L1HqaS4J6yBqxwa/Y3nMBaxVKbB/NsA==",
+      "dev": true,
+      "funding": [
+        {
+          "type": "github",
+          "url": "https://github.com/sponsors/csstools"
+        },
+        {
+          "type": "opencollective",
+          "url": "https://opencollective.com/csstools"
+        }
+      ],
+      "license": "MIT",
+      "engines": {
+        "node": ">=20.19.0"
+      }
+    },
     "node_modules/@dimforge/rapier3d-compat": {
       "version": "0.12.0",
       "resolved": "https://registry.npmjs.org/@dimforge/rapier3d-compat/-/rapier3d-compat-0.12.0.tgz",
@@ -604,6 +820,24 @@
         "node": ">=12"
       }
     },
+    "node_modules/@exodus/bytes": {
+      "version": "1.15.0",
+      "resolved": "https://registry.npmjs.org/@exodus/bytes/-/bytes-1.15.0.tgz",
+      "integrity": "sha512-UY0nlA+feH81UGSHv92sLEPLCeZFjXOuHhrIo0HQydScuQc8s0A7kL/UdgwgDq8g8ilksmuoF35YVTNphV2aBQ==",
+      "dev": true,
+      "license": "MIT",
+      "engines": {
+        "node": "^20.19.0 || ^22.12.0 || >=24.0.0"
+      },
+      "peerDependencies": {
+        "@noble/hashes": "^1.8.0 || ^2.0.0"
+      },
+      "peerDependenciesMeta": {
+        "@noble/hashes": {
+          "optional": true
+        }
+      }
+    },
     "node_modules/@huggingface/jinja": {
       "version": "0.5.6",
       "resolved": "https://registry.npmjs.org/@huggingface/jinja/-/jinja-0.5.6.tgz",
@@ -1644,6 +1878,26 @@
       "dev": true,
       "license": "MIT"
     },
+    "node_modules/@types/jsdom": {
+      "version": "28.0.1",
+      "resolved": "https://registry.npmjs.org/@types/jsdom/-/jsdom-28.0.1.tgz",
+      "integrity": "sha512-GJq2QE4TAZ5ajSoCasn5DOFm8u1mI3tIFvM5tIq3W5U/RTB6gsHwc6Yhpl91X9VSDOUVblgXmG+2+sSvFQrdlw==",
+      "dev": true,
+      "license": "MIT",
+      "dependencies": {
+        "@types/node": "*",
+        "@types/tough-cookie": "*",
+        "parse5": "^7.0.0",
+        "undici-types": "^7.21.0"
+      }
+    },
+    "node_modules/@types/jsdom/node_modules/undici-types": {
+      "version": "7.24.6",
+      "resolved": "https://registry.npmjs.org/undici-types/-/undici-types-7.24.6.tgz",
+      "integrity": "sha512-WRNW+sJgj5OBN4/0JpHFqtqzhpbnV0GuB+OozA9gCL7a993SmU+1JBZCzLNxYsbMfIeDL+lTsphD5jN5N+n0zg==",
+      "dev": true,
+      "license": "MIT"
+    },
     "node_modules/@types/node": {
       "version": "20.19.37",
       "resolved": "https://registry.npmjs.org/@types/node/-/node-20.19.37.tgz",
@@ -1676,6 +1930,13 @@
         "meshoptimizer": "~1.0.1"
       }
     },
+    "node_modules/@types/tough-cookie": {
+      "version": "4.0.5",
+      "resolved": "https://registry.npmjs.org/@types/tough-cookie/-/tough-cookie-4.0.5.tgz",
+      "integrity": "sha512-/Ad8+nIOV7Rl++6f1BdKxFSMgmoqEoYbHRpPcx3JEfv8VRsQe9Z4mCXeJBzxs7mbHY/XOZZuXlRNfhpVPbs6ZA==",
+      "dev": true,
+      "license": "MIT"
+    },
     "node_modules/@types/vscode": {
       "version": "1.110.0",
       "resolved": "https://registry.npmjs.org/@types/vscode/-/vscode-1.110.0.tgz",
@@ -2105,6 +2366,16 @@
       "license": "MIT",
       "optional": true
     },
+    "node_modules/bidi-js": {
+      "version": "1.0.3",
+      "resolved": "https://registry.npmjs.org/bidi-js/-/bidi-js-1.0.3.tgz",
+      "integrity": "sha512-RKshQI1R3YQ+n9YJz2QQ147P66ELpa1FQEg20Dk8oW9t2KgLbpDLLp9aGZ7y8WHSshDknG0bknqGw5/tyCs5tw==",
+      "dev": true,
+      "license": "MIT",
+      "dependencies": {
+        "require-from-string": "^2.0.2"
+      }
+    },
     "node_modules/bl": {
       "version": "4.1.0",
       "resolved": "https://registry.npmjs.org/bl/-/bl-4.1.0.tgz",
@@ -2439,6 +2710,20 @@
         "url": "https://github.com/sponsors/fb55"
       }
     },
+    "node_modules/css-tree": {
+      "version": "3.2.1",
+      "resolved": "https://registry.npmjs.org/css-tree/-/css-tree-3.2.1.tgz",
+      "integrity": "sha512-X7sjQzceUhu1u7Y/ylrRZFU2FS6LRiFVp6rKLPg23y3x3c3DOKAwuXGDp+PAGjh6CSnCjYeAul8pcT8bAl+lSA==",
+      "dev": true,
+      "license": "MIT",
+      "dependencies": {
+        "mdn-data": "2.27.1",
+        "source-map-js": "^1.2.1"
+      },
+      "engines": {
+        "node": "^10 || ^12.20.0 || ^14.13.0 || >=15.0.0"
+      }
+    },
     "node_modules/css-what": {
       "version": "6.2.2",
       "resolved": "https://registry.npmjs.org/css-what/-/css-what-6.2.2.tgz",
@@ -2614,6 +2899,30 @@
         "node": ">=12"
       }
     },
+    "node_modules/data-urls": {
+      "version": "7.0.0",
+      "resolved": "https://registry.npmjs.org/data-urls/-/data-urls-7.0.0.tgz",
+      "integrity": "sha512-23XHcCF+coGYevirZceTVD7NdJOqVn+49IHyxgszm+JIiHLoB2TkmPtsYkNWT1pvRSGkc35L6NHs0yHkN2SumA==",
+      "dev": true,
+      "license": "MIT",
+      "dependencies": {
+        "whatwg-mimetype": "^5.0.0",
+        "whatwg-url": "^16.0.0"
+      },
+      "engines": {
+        "node": "^20.19.0 || ^22.12.0 || >=24.0.0"
+      }
+    },
+    "node_modules/data-urls/node_modules/whatwg-mimetype": {
+      "version": "5.0.0",
+      "resolved": "https://registry.npmjs.org/whatwg-mimetype/-/whatwg-mimetype-5.0.0.tgz",
+      "integrity": "sha512-sXcNcHOC51uPGF0P/D4NVtrkjSU2fNsm9iog4ZvZJsL3rjoDAzXZhkm2MWt1y+PUdggKAYVoMAIYcs78wJ51Cw==",
+      "dev": true,
+      "license": "MIT",
+      "engines": {
+        "node": ">=20"
+      }
+    },
     "node_modules/debug": {
       "version": "4.4.3",
       "resolved": "https://registry.npmjs.org/debug/-/debug-4.4.3.tgz",
@@ -2632,6 +2941,13 @@
         }
       }
     },
+    "node_modules/decimal.js": {
+      "version": "10.6.0",
+      "resolved": "https://registry.npmjs.org/decimal.js/-/decimal.js-10.6.0.tgz",
+      "integrity": "sha512-YpgQiITW3JXGntzdUmyUR1V812Hn8T1YVXhCu+wO3OpS4eU9l4YdD3qjyiKdV6mvV29zapkMeD390UVEf2lkUg==",
+      "dev": true,
+      "license": "MIT"
+    },
     "node_modules/decompress-response": {
       "version": "6.0.0",
       "resolved": "https://registry.npmjs.org/decompress-response/-/decompress-response-6.0.0.tgz",
@@ -3354,6 +3670,19 @@
         "node": ">=10"
       }
     },
+    "node_modules/html-encoding-sniffer": {
+      "version": "6.0.0",
+      "resolved": "https://registry.npmjs.org/html-encoding-sniffer/-/html-encoding-sniffer-6.0.0.tgz",
+      "integrity": "sha512-CV9TW3Y3f8/wT0BRFc1/KAVQ3TUHiXmaAb6VW9vtiMFf7SLoMd1PdAc4W3KFOFETBJUb90KatHqlsZMWV+R9Gg==",
+      "dev": true,
+      "license": "MIT",
+      "dependencies": {
+        "@exodus/bytes": "^1.6.0"
+      },
+      "engines": {
+        "node": "^20.19.0 || ^22.12.0 || >=24.0.0"
+      }
+    },
     "node_modules/htmlparser2": {
       "version": "10.1.0",
       "resolved": "https://registry.npmjs.org/htmlparser2/-/htmlparser2-10.1.0.tgz",
@@ -3531,6 +3860,13 @@
         "url": "https://github.com/sponsors/sindresorhus"
       }
     },
+    "node_modules/is-potential-custom-element-name": {
+      "version": "1.0.1",
+      "resolved": "https://registry.npmjs.org/is-potential-custom-element-name/-/is-potential-custom-element-name-1.0.1.tgz",
+      "integrity": "sha512-bCYeRA2rVibKZd+s2625gGnGF/t7DSqDs4dP7CrLA1m7jKWz6pps0LpYLJN8Q64HtmPKJ1hrN3nzPNKFEKOUiQ==",
+      "dev": true,
+      "license": "MIT"
+    },
     "node_modules/is-stream": {
       "version": "3.0.0",
       "resolved": "https://registry.npmjs.org/is-stream/-/is-stream-3.0.0.tgz",
@@ -3574,6 +3910,93 @@
       "dev": true,
       "license": "MIT"
     },
+    "node_modules/jsdom": {
+      "version": "29.0.1",
+      "resolved": "https://registry.npmjs.org/jsdom/-/jsdom-29.0.1.tgz",
+      "integrity": "sha512-z6JOK5gRO7aMybVq/y/MlIpKh8JIi68FBKMUtKkK2KH/wMSRlCxQ682d08LB9fYXplyY/UXG8P4XXTScmdjApg==",
+      "dev": true,
+      "license": "MIT",
+      "dependencies": {
+        "@asamuzakjp/css-color": "^5.0.1",
+        "@asamuzakjp/dom-selector": "^7.0.3",
+        "@bramus/specificity": "^2.4.2",
+        "@csstools/css-syntax-patches-for-csstree": "^1.1.1",
+        "@exodus/bytes": "^1.15.0",
+        "css-tree": "^3.2.1",
+        "data-urls": "^7.0.0",
+        "decimal.js": "^10.6.0",
+        "html-encoding-sniffer": "^6.0.0",
+        "is-potential-custom-element-name": "^1.0.1",
+        "lru-cache": "^11.2.7",
+        "parse5": "^8.0.0",
+        "saxes": "^6.0.0",
+        "symbol-tree": "^3.2.4",
+        "tough-cookie": "^6.0.1",
+        "undici": "^7.24.5",
+        "w3c-xmlserializer": "^5.0.0",
+        "webidl-conversions": "^8.0.1",
+        "whatwg-mimetype": "^5.0.0",
+        "whatwg-url": "^16.0.1",
+        "xml-name-validator": "^5.0.0"
+      },
+      "engines": {
+        "node": "^20.19.0 || ^22.13.0 || >=24.0.0"
+      },
+      "peerDependencies": {
+        "canvas": "^3.0.0"
+      },
+      "peerDependenciesMeta": {
+        "canvas": {
+          "optional": true
+        }
+      }
+    },
+    "node_modules/jsdom/node_modules/entities": {
+      "version": "6.0.1",
+      "resolved": "https://registry.npmjs.org/entities/-/entities-6.0.1.tgz",
+      "integrity": "sha512-aN97NXWF6AWBTahfVOIrB/NShkzi5H7F9r1s9mD3cDj4Ko5f2qhhVoYMibXF7GlLveb/D2ioWay8lxI97Ven3g==",
+      "dev": true,
+      "license": "BSD-2-Clause",
+      "engines": {
+        "node": ">=0.12"
+      },
+      "funding": {
+        "url": "https://github.com/fb55/entities?sponsor=1"
+      }
+    },
+    "node_modules/jsdom/node_modules/lru-cache": {
+      "version": "11.2.7",
+      "resolved": "https://registry.npmjs.org/lru-cache/-/lru-cache-11.2.7.tgz",
+      "integrity": "sha512-aY/R+aEsRelme17KGQa/1ZSIpLpNYYrhcrepKTZgE+W3WM16YMCaPwOHLHsmopZHELU0Ojin1lPVxKR0MihncA==",
+      "dev": true,
+      "license": "BlueOak-1.0.0",
+      "engines": {
+        "node": "20 || >=22"
+      }
+    },
+    "node_modules/jsdom/node_modules/parse5": {
+      "version": "8.0.0",
+      "resolved": "https://registry.npmjs.org/parse5/-/parse5-8.0.0.tgz",
+      "integrity": "sha512-9m4m5GSgXjL4AjumKzq1Fgfp3Z8rsvjRNbnkVwfu2ImRqE5D0LnY2QfDen18FSY9C573YU5XxSapdHZTZ2WolA==",
+      "dev": true,
+      "license": "MIT",
+      "dependencies": {
+        "entities": "^6.0.0"
+      },
+      "funding": {
+        "url": "https://github.com/inikulin/parse5?sponsor=1"
+      }
+    },
+    "node_modules/jsdom/node_modules/whatwg-mimetype": {
+      "version": "5.0.0",
+      "resolved": "https://registry.npmjs.org/whatwg-mimetype/-/whatwg-mimetype-5.0.0.tgz",
+      "integrity": "sha512-sXcNcHOC51uPGF0P/D4NVtrkjSU2fNsm9iog4ZvZJsL3rjoDAzXZhkm2MWt1y+PUdggKAYVoMAIYcs78wJ51Cw==",
+      "dev": true,
+      "license": "MIT",
+      "engines": {
+        "node": ">=20"
+      }
+    },
     "node_modules/json-stringify-safe": {
       "version": "5.0.1",
       "resolved": "https://registry.npmjs.org/json-stringify-safe/-/json-stringify-safe-5.0.1.tgz",
@@ -3850,6 +4273,13 @@
         "node": ">= 0.4"
       }
     },
+    "node_modules/mdn-data": {
+      "version": "2.27.1",
+      "resolved": "https://registry.npmjs.org/mdn-data/-/mdn-data-2.27.1.tgz",
+      "integrity": "sha512-9Yubnt3e8A0OKwxYSXyhLymGW4sCufcLG6VdiDdUGVkPhpqLxlvP5vl1983gQjJl3tqbrM731mjaZaP68AgosQ==",
+      "dev": true,
+      "license": "CC0-1.0"
+    },
     "node_modules/mdurl": {
       "version": "1.0.1",
       "resolved": "https://registry.npmjs.org/mdurl/-/mdurl-1.0.1.tgz",
@@ -4547,6 +4977,16 @@
         "once": "^1.3.1"
       }
     },
+    "node_modules/punycode": {
+      "version": "2.3.1",
+      "resolved": "https://registry.npmjs.org/punycode/-/punycode-2.3.1.tgz",
+      "integrity": "sha512-vYt7UD1U9Wg6138shLtLOvdAu+8DsC/ilFtEVHcH+wydcSpNE20AfSOduf6MkRFahL5FY7X1oU7nKVZFtfq8Fg==",
+      "dev": true,
+      "license": "MIT",
+      "engines": {
+        "node": ">=6"
+      }
+    },
     "node_modules/qs": {
       "version": "6.15.0",
       "resolved": "https://registry.npmjs.org/qs/-/qs-6.15.0.tgz",
@@ -4616,6 +5056,16 @@
         "node": ">= 6"
       }
     },
+    "node_modules/require-from-string": {
+      "version": "2.0.2",
+      "resolved": "https://registry.npmjs.org/require-from-string/-/require-from-string-2.0.2.tgz",
+      "integrity": "sha512-Xf0nWe6RseziFMu+Ap9biiUbmplq6S9/p+7w7YXP/JBHhrUDDUhwa+vANyubuqfZWTveU//DYVGsDG7RKL/vEw==",
+      "dev": true,
+      "license": "MIT",
+      "engines": {
+        "node": ">=0.10.0"
+      }
+    },
     "node_modules/roarr": {
       "version": "2.15.4",
       "resolved": "https://registry.npmjs.org/roarr/-/roarr-2.15.4.tgz",
@@ -4729,6 +5179,19 @@
         "node": ">=11.0.0"
       }
     },
+    "node_modules/saxes": {
+      "version": "6.0.0",
+      "resolved": "https://registry.npmjs.org/saxes/-/saxes-6.0.0.tgz",
+      "integrity": "sha512-xAg7SOnEhrm5zI3puOOKyy1OMcMlIJZYNJY7xLBwSze0UjhPLnWfj2GF2EpT0jmzaJKIWKHLsaSSajf35bcYnA==",
+      "dev": true,
+      "license": "ISC",
+      "dependencies": {
+        "xmlchars": "^2.2.0"
+      },
+      "engines": {
+        "node": ">=v12.22.7"
+      }
+    },
     "node_modules/semver": {
       "version": "7.7.4",
       "resolved": "https://registry.npmjs.org/semver/-/semver-7.7.4.tgz",
@@ -5065,6 +5528,13 @@
         "node": ">=4"
       }
     },
+    "node_modules/symbol-tree": {
+      "version": "3.2.4",
+      "resolved": "https://registry.npmjs.org/symbol-tree/-/symbol-tree-3.2.4.tgz",
+      "integrity": "sha512-9QNk5KwDF+Bvz+PyObkmSYjI5ksVUYtjW7AU22r2NKcfLJcXp96hkDWU3+XndOsUb+AQ9QhfzfCT2O+CNWT5Tw==",
+      "dev": true,
+      "license": "MIT"
+    },
     "node_modules/tar": {
       "version": "7.5.13",
       "resolved": "https://registry.npmjs.org/tar/-/tar-7.5.13.tgz",
@@ -5193,6 +5663,26 @@
         "node": ">=14.0.0"
       }
     },
+    "node_modules/tldts": {
+      "version": "7.0.27",
+      "resolved": "https://registry.npmjs.org/tldts/-/tldts-7.0.27.tgz",
+      "integrity": "sha512-I4FZcVFcqCRuT0ph6dCDpPuO4Xgzvh+spkcTr1gK7peIvxWauoloVO0vuy1FQnijT63ss6AsHB6+OIM4aXHbPg==",
+      "dev": true,
+      "license": "MIT",
+      "dependencies": {
+        "tldts-core": "^7.0.27"
+      },
+      "bin": {
+        "tldts": "bin/cli.js"
+      }
+    },
+    "node_modules/tldts-core": {
+      "version": "7.0.27",
+      "resolved": "https://registry.npmjs.org/tldts-core/-/tldts-core-7.0.27.tgz",
+      "integrity": "sha512-YQ7uPjgWUibIK6DW5lrKujGwUKhLevU4hcGbP5O6TcIUb+oTjJYJVWPS4nZsIHrEEEG6myk/oqAJUEQmpZrHsg==",
+      "dev": true,
+      "license": "MIT"
+    },
     "node_modules/tmp": {
       "version": "0.2.5",
       "resolved": "https://registry.npmjs.org/tmp/-/tmp-0.2.5.tgz",
@@ -5203,6 +5693,32 @@
         "node": ">=14.14"
       }
     },
+    "node_modules/tough-cookie": {
+      "version": "6.0.1",
+      "resolved": "https://registry.npmjs.org/tough-cookie/-/tough-cookie-6.0.1.tgz",
+      "integrity": "sha512-LktZQb3IeoUWB9lqR5EWTHgW/VTITCXg4D21M+lvybRVdylLrRMnqaIONLVb5mav8vM19m44HIcGq4qASeu2Qw==",
+      "dev": true,
+      "license": "BSD-3-Clause",
+      "dependencies": {
+        "tldts": "^7.0.5"
+      },
+      "engines": {
+        "node": ">=16"
+      }
+    },
+    "node_modules/tr46": {
+      "version": "6.0.0",
+      "resolved": "https://registry.npmjs.org/tr46/-/tr46-6.0.0.tgz",
+      "integrity": "sha512-bLVMLPtstlZ4iMQHpFHTR7GAGj2jxi8Dg0s2h2MafAE4uSWF98FC/3MomU51iQAMf8/qDUbKWf5GxuvvVcXEhw==",
+      "dev": true,
+      "license": "MIT",
+      "dependencies": {
+        "punycode": "^2.3.1"
+      },
+      "engines": {
+        "node": ">=20"
+      }
+    },
     "node_modules/tslib": {
       "version": "2.8.1",
       "resolved": "https://registry.npmjs.org/tslib/-/tslib-2.8.1.tgz",
@@ -5923,6 +6439,29 @@
         }
       }
     },
+    "node_modules/w3c-xmlserializer": {
+      "version": "5.0.0",
+      "resolved": "https://registry.npmjs.org/w3c-xmlserializer/-/w3c-xmlserializer-5.0.0.tgz",
+      "integrity": "sha512-o8qghlI8NZHU1lLPrpi2+Uq7abh4GGPpYANlalzWxyWteJOCsr/P+oPBA49TOLu5FTZO4d3F9MnWJfiMo4BkmA==",
+      "dev": true,
+      "license": "MIT",
+      "dependencies": {
+        "xml-name-validator": "^5.0.0"
+      },
+      "engines": {
+        "node": ">=18"
+      }
+    },
+    "node_modules/webidl-conversions": {
+      "version": "8.0.1",
+      "resolved": "https://registry.npmjs.org/webidl-conversions/-/webidl-conversions-8.0.1.tgz",
+      "integrity": "sha512-BMhLD/Sw+GbJC21C/UgyaZX41nPt8bUTg+jWyDeg7e7YN4xOM05YPSIXceACnXVtqyEw/LMClUQMtMZ+PGGpqQ==",
+      "dev": true,
+      "license": "BSD-2-Clause",
+      "engines": {
+        "node": ">=20"
+      }
+    },
     "node_modules/whatwg-encoding": {
       "version": "3.1.1",
       "resolved": "https://registry.npmjs.org/whatwg-encoding/-/whatwg-encoding-3.1.1.tgz",
@@ -5947,6 +6486,21 @@
         "node": ">=18"
       }
     },
+    "node_modules/whatwg-url": {
+      "version": "16.0.1",
+      "resolved": "https://registry.npmjs.org/whatwg-url/-/whatwg-url-16.0.1.tgz",
+      "integrity": "sha512-1to4zXBxmXHV3IiSSEInrreIlu02vUOvrhxJJH5vcxYTBDAx51cqZiKdyTxlecdKNSjj8EcxGBxNf6Vg+945gw==",
+      "dev": true,
+      "license": "MIT",
+      "dependencies": {
+        "@exodus/bytes": "^1.11.0",
+        "tr46": "^6.0.0",
+        "webidl-conversions": "^8.0.1"
+      },
+      "engines": {
+        "node": "^20.19.0 || ^22.12.0 || >=24.0.0"
+      }
+    },
     "node_modules/which": {
       "version": "2.0.2",
       "resolved": "https://registry.npmjs.org/which/-/which-2.0.2.tgz",
@@ -6024,6 +6578,16 @@
         "url": "https://github.com/sponsors/sindresorhus"
       }
     },
+    "node_modules/xml-name-validator": {
+      "version": "5.0.0",
+      "resolved": "https://registry.npmjs.org/xml-name-validator/-/xml-name-validator-5.0.0.tgz",
+      "integrity": "sha512-EvGK8EJ3DhaHfbRlETOWAS5pO9MZITeauHKJyb8wyajUfQUenkIg2MvLDTZ4T/TgIcm3HU0TFBgWWboAZ30UHg==",
+      "dev": true,
+      "license": "Apache-2.0",
+      "engines": {
+        "node": ">=18"
+      }
+    },
     "node_modules/xml2js": {
       "version": "0.5.0",
       "resolved": "https://registry.npmjs.org/xml2js/-/xml2js-0.5.0.tgz",
@@ -6048,6 +6612,13 @@
         "node": ">=4.0"
       }
     },
+    "node_modules/xmlchars": {
+      "version": "2.2.0",
+      "resolved": "https://registry.npmjs.org/xmlchars/-/xmlchars-2.2.0.tgz",
+      "integrity": "sha512-JZnDKK8B0RCDw84FNdDAIpZK+JuJw+s7Lz8nksI7SIuU3UXJJslUthsi+uWBUYOwPFwW7W7PRLRfUKpxjtjFCw==",
+      "dev": true,
+      "license": "MIT"
+    },
     "node_modules/yallist": {
       "version": "4.0.0",
       "resolved": "https://registry.npmjs.org/yallist/-/yallist-4.0.0.tgz",
diff --git a/03-vscode-extension/package.json b/03-vscode-extension/package.json
index ba6a678..2b8ca05 100644
--- a/03-vscode-extension/package.json
+++ b/03-vscode-extension/package.json
@@ -57,12 +57,14 @@
     "typecheck": "tsc --noEmit"
   },
   "devDependencies": {
+    "@types/jsdom": "^28.0.1",
     "@types/node": "^20.0.0",
     "@types/three": "^0.183.1",
     "@types/vscode": "^1.85.0",
     "@types/ws": "^8.5.0",
     "@vscode/vsce": "^2.23.0",
     "esbuild": "^0.20.0",
+    "jsdom": "^29.0.1",
     "typescript": "^5.3.0",
     "vitest": "^1.0.0"
   },
diff --git a/03-vscode-extension/webview/__tests__/orb.test.ts b/03-vscode-extension/webview/__tests__/orb.test.ts
new file mode 100644
index 0000000..142ade1
--- /dev/null
+++ b/03-vscode-extension/webview/__tests__/orb.test.ts
@@ -0,0 +1,142 @@
+// @vitest-environment jsdom
+import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
+import type { GraphNode, GraphEdge } from '../../src/types';
+
+// Capture the onFinishUpdate callback registered at module-init time.
+const { onFinishUpdateCallbacks } = vi.hoisted(() => ({
+  onFinishUpdateCallbacks: [] as (() => void)[],
+}));
+
+vi.mock('three-forcegraph', () => {
+  const mockGraph = {
+    forceEngine: vi.fn().mockReturnThis(),
+    warmupTicks: vi.fn().mockReturnThis(),
+    d3Force: vi.fn().mockReturnThis(),
+    onFinishUpdate: vi.fn().mockImplementation((cb: () => void) => {
+      onFinishUpdateCallbacks.push(cb);
+      return mockGraph;
+    }),
+    graphData: vi.fn().mockReturnThis(),
+    tickFrame: vi.fn().mockReturnThis(),
+  };
+  return { default: vi.fn().mockImplementation(() => mockGraph) };
+});
+
+// renderer.ts only exports a constant + function — safe to import without mocking three
+vi.mock('../renderer', () => ({ ORB_RADIUS: 120 }));
+
+import { capAndTransform, updateGraph } from '../orb';
+
+// ── helpers ────────────────────────────────────────────────────────────────────
+
+function makeNode(id: string, label = id): GraphNode {
+  return { id, type: 'project', label };
+}
+
+function makeEdge(id: string, source: string, target: string, weight: number): GraphEdge {
+  return { id, source, target, weight, connection_type: 'uses', raw_count: 1, first_seen: '2024-01-01', last_seen: '2024-01-01' };
+}
+
+// ── capAndTransform ────────────────────────────────────────────────────────────
+
+describe('capAndTransform', () => {
+  it('passes an empty snapshot through unchanged', () => {
+    const result = capAndTransform({ nodes: [], edges: [] });
+    expect(result.nodes).toEqual([]);
+    expect(result.links).toEqual([]);
+    expect(result.wasCapped).toBe(false);
+    expect(result.originalCounts).toEqual({ nodes: 0, edges: 0 });
+  });
+
+  it('renames edges to links — no "edges" key in output', () => {
+    const node = makeNode('a');
+    const edge = makeEdge('e1', 'a', 'a', 1);
+    const result = capAndTransform({ nodes: [node], edges: [edge] });
+    expect('edges' in result).toBe(false);
+    expect(result.links).toHaveLength(1);
+  });
+
+  it('preserves edge id and all fields in the link object', () => {
+    const edge = makeEdge('edge-1', 'src', 'dst', 2.5);
+    const result = capAndTransform({ nodes: [makeNode('src'), makeNode('dst')], edges: [edge] });
+    expect(result.links[0].id).toBe('edge-1');
+    expect(result.links[0].weight).toBe(2.5);
+    expect(result.links[0].connection_type).toBe('uses');
+    expect(result.links[0].source).toBe('src');
+    expect(result.links[0].target).toBe('dst');
+  });
+
+  it('does not cap when node count is ≤ 500', () => {
+    const nodes = Array.from({ length: 500 }, (_, i) => makeNode(`n${i}`));
+    const edges = [makeEdge('e1', 'n0', 'n1', 1)];
+    const result = capAndTransform({ nodes, edges });
+    expect(result.wasCapped).toBe(false);
+    expect(result.nodes).toHaveLength(500);
+  });
+
+  it('caps to top maxEdges by weight when node count > 500', () => {
+    // 501 nodes, 400 edges with varying weights
+    const nodes = Array.from({ length: 501 }, (_, i) => makeNode(`n${i}`));
+    const edges = Array.from({ length: 400 }, (_, i) =>
+      makeEdge(`e${i}`, `n${i % 501}`, `n${(i + 1) % 501}`, i) // weight = index → higher i = heavier
+    );
+    const result = capAndTransform({ nodes, edges }, 300);
+    expect(result.wasCapped).toBe(true);
+    expect(result.links).toHaveLength(300);
+    // All retained edges should be from the top 300 by weight (indices 100-399)
+    const minWeight = Math.min(...result.links.map(l => l.weight));
+    expect(minWeight).toBeGreaterThanOrEqual(100);
+  });
+
+  it('records original counts when capped', () => {
+    const nodes = Array.from({ length: 501 }, (_, i) => makeNode(`n${i}`));
+    const edges = Array.from({ length: 50 }, (_, i) =>
+      makeEdge(`e${i}`, `n${i}`, `n${i + 1}`, i)
+    );
+    const result = capAndTransform({ nodes, edges });
+    expect(result.originalCounts).toEqual({ nodes: 501, edges: 50 });
+  });
+
+  it('emits console.warn with original counts when capped and updateGraph is called', () => {
+    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
+    const nodes = Array.from({ length: 501 }, (_, i) => makeNode(`n${i}`));
+    const edges = Array.from({ length: 400 }, (_, i) =>
+      makeEdge(`e${i}`, `n${i % 501}`, `n${(i + 1) % 501}`, i)
+    );
+    updateGraph({ nodes, edges });
+    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('501'));
+    warnSpy.mockRestore();
+  });
+});
+
+// ── loading overlay ────────────────────────────────────────────────────────────
+
+describe('loading overlay', () => {
+  beforeEach(() => {
+    // Clean DOM before each test
+    const existing = document.getElementById('devneural-loading');
+    existing?.remove();
+  });
+
+  afterEach(() => {
+    const existing = document.getElementById('devneural-loading');
+    existing?.remove();
+  });
+
+  it('shows loading overlay when updateGraph is called', () => {
+    updateGraph({ nodes: [], edges: [] });
+    expect(document.getElementById('devneural-loading')).not.toBeNull();
+  });
+
+  it('removes loading overlay when onFinishUpdate callback fires', () => {
+    updateGraph({ nodes: [], edges: [] });
+    expect(document.getElementById('devneural-loading')).not.toBeNull();
+
+    // Fire the callback registered via graph.onFinishUpdate(() => hideLoading())
+    const hideLoading = onFinishUpdateCallbacks[0];
+    expect(hideLoading).toBeDefined();
+    hideLoading();
+
+    expect(document.getElementById('devneural-loading')).toBeNull();
+  });
+});
diff --git a/03-vscode-extension/webview/__tests__/renderer.test.ts b/03-vscode-extension/webview/__tests__/renderer.test.ts
new file mode 100644
index 0000000..6ad1b3d
--- /dev/null
+++ b/03-vscode-extension/webview/__tests__/renderer.test.ts
@@ -0,0 +1,96 @@
+// @vitest-environment jsdom
+import { vi, describe, it, expect, beforeEach } from 'vitest';
+
+// Mocks must be defined before importing the module under test.
+// vi.hoisted lets us declare shared state that can be referenced in vi.mock factories.
+const mocks = vi.hoisted(() => {
+  const rendererInst = {
+    setPixelRatio: vi.fn(),
+    setSize: vi.fn(),
+    render: vi.fn(),
+    domElement: null as unknown as HTMLElement,
+    _opts: {} as Record<string, unknown>,
+  };
+  const cameraInst = {
+    position: { set: vi.fn() },
+    aspect: 0,
+    updateProjectionMatrix: vi.fn(),
+  };
+  const controlsInst = { enableDamping: false, update: vi.fn() };
+  const sceneInst = { add: vi.fn(), fog: null as unknown };
+  return { rendererInst, cameraInst, controlsInst, sceneInst };
+});
+
+vi.mock('three', () => ({
+  WebGLRenderer: vi.fn().mockImplementation((opts: unknown) => {
+    mocks.rendererInst._opts = (opts as Record<string, unknown>) ?? {};
+    mocks.rendererInst.domElement = document.createElement('canvas');
+    return mocks.rendererInst;
+  }),
+  PerspectiveCamera: vi.fn().mockImplementation(() => mocks.cameraInst),
+  Scene: vi.fn().mockImplementation(() => mocks.sceneInst),
+  AmbientLight: vi.fn().mockImplementation(() => ({})),
+  DirectionalLight: vi.fn().mockImplementation(() => ({ position: { set: vi.fn() } })),
+  FogExp2: vi.fn(),
+  Clock: vi.fn().mockImplementation(() => ({ getDelta: vi.fn().mockReturnValue(0.016) })),
+}));
+
+vi.mock('three/examples/jsm/controls/OrbitControls.js', () => ({
+  OrbitControls: vi.fn().mockImplementation(() => mocks.controlsInst),
+}));
+
+// Import AFTER mocks are set up
+import { ORB_RADIUS, createScene } from '../renderer';
+
+describe('renderer.ts', () => {
+  let canvas: HTMLCanvasElement;
+  let resizeCallback: (() => void) | null = null;
+
+  beforeEach(() => {
+    canvas = document.createElement('canvas');
+    Object.defineProperty(canvas, 'clientWidth', { value: 800, configurable: true });
+    Object.defineProperty(canvas, 'clientHeight', { value: 600, configurable: true });
+
+    vi.clearAllMocks();
+    resizeCallback = null;
+
+    // Mock ResizeObserver (not implemented in jsdom)
+    global.ResizeObserver = vi.fn().mockImplementation((cb: () => void) => {
+      resizeCallback = cb;
+      return { observe: vi.fn(), disconnect: vi.fn() };
+    });
+  });
+
+  it('creates WebGLRenderer with antialias: true', () => {
+    createScene(canvas);
+    expect(mocks.rendererInst._opts).toMatchObject({ antialias: true });
+  });
+
+  it('positions camera at distance that frames ORB_RADIUS sphere (75° FOV)', () => {
+    createScene(canvas);
+    const expectedDistance = ORB_RADIUS / Math.sin((75 / 2) * (Math.PI / 180));
+    const [x, y, z] = (mocks.cameraInst.position.set as ReturnType<typeof vi.fn>).mock.calls[0];
+    expect(x).toBe(0);
+    expect(y).toBe(0);
+    expect(z).toBeCloseTo(expectedDistance, 1);
+  });
+
+  it('creates OrbitControls with enableDamping: true', () => {
+    createScene(canvas);
+    expect(mocks.controlsInst.enableDamping).toBe(true);
+  });
+
+  it('ResizeObserver callback updates renderer size and camera aspect ratio', () => {
+    createScene(canvas);
+    expect(resizeCallback).not.toBeNull();
+
+    // Update canvas dimensions and trigger resize
+    Object.defineProperty(canvas, 'clientWidth', { value: 1280, configurable: true });
+    Object.defineProperty(canvas, 'clientHeight', { value: 720, configurable: true });
+    resizeCallback!();
+
+    expect(mocks.rendererInst.setSize).toHaveBeenCalledWith(1280, 720);
+    expect(mocks.cameraInst.updateProjectionMatrix).toHaveBeenCalled();
+    expect(mocks.cameraInst.aspect).toBeCloseTo(1280 / 720, 3);
+  });
+});
diff --git a/03-vscode-extension/webview/main.ts b/03-vscode-extension/webview/main.ts
index 79ed57d..8fa52de 100644
--- a/03-vscode-extension/webview/main.ts
+++ b/03-vscode-extension/webview/main.ts
@@ -1,12 +1,23 @@
-// Entry point for the DevNeural webview bundle.
-// Full implementation in section-06-threejs-scene and beyond.
-import { WebGLRenderer } from 'three';
+import { createScene } from './renderer';
+import { updateGraph, getGraphInstance } from './orb';
+import type { GraphSnapshot } from '../src/types';
 
-// Expose renderer class so the extension host can detect WebGL support.
-// Side-effectful assignment prevents tree-shaking — used in section-06.
-(window as unknown as Record<string, unknown>)['DevNeuralRendererClass'] = WebGLRenderer;
+const canvas = document.getElementById('devneural-canvas') as HTMLCanvasElement;
+const { scene, startAnimationLoop } = createScene(canvas);
+
+scene.add(getGraphInstance());
+startAnimationLoop(() => {
+  getGraphInstance().tickFrame();
+});
 
 window.addEventListener('message', (event: MessageEvent) => {
-  const message = event.data as { type: string; payload: unknown };
-  void message; // Routing implemented in section-06
+  const { type, payload } = event.data as { type: string; payload: unknown };
+  switch (type) {
+    case 'graph:snapshot':
+      updateGraph(payload as GraphSnapshot);
+      break;
+    case 'setActiveProjects':
+      // Camera module handles this — wired in section-09
+      break;
+  }
 });
diff --git a/03-vscode-extension/webview/orb.ts b/03-vscode-extension/webview/orb.ts
index cf869f4..4287883 100644
--- a/03-vscode-extension/webview/orb.ts
+++ b/03-vscode-extension/webview/orb.ts
@@ -1,2 +1,141 @@
-// Implemented in section-06-threejs-scene
-export {};
+import ThreeForceGraph from 'three-forcegraph';
+import type { NodeObject } from 'three-forcegraph';
+import { ORB_RADIUS } from './renderer';
+import type { GraphNode, GraphEdge, GraphSnapshot } from '../src/types';
+
+export type { GraphSnapshot };
+
+type GraphLink = GraphEdge & { source: string; target: string };
+
+const GRAPH_NODE_CAP = 500;
+const GRAPH_EDGE_CAP = 300;
+
+const DEVNEURAL_CENTER_ID = 'project:github.com/mcollins-f6i/DevNeural';
+const DEVNEURAL_CENTER_LABEL = 'DevNeural';
+
+// ── Pure transform function (independently testable) ──────────────────────────
+
+export function capAndTransform(
+  snapshot: GraphSnapshot,
+  maxEdges = GRAPH_EDGE_CAP
+): {
+  nodes: (GraphNode & { fx?: number; fy?: number; fz?: number })[];
+  links: GraphLink[];
+  wasCapped: boolean;
+  originalCounts: { nodes: number; edges: number };
+} {
+  const originalCounts = { nodes: snapshot.nodes.length, edges: snapshot.edges.length };
+
+  let nodes = snapshot.nodes;
+  let edges = snapshot.edges;
+  let wasCapped = false;
+
+  if (snapshot.nodes.length > GRAPH_NODE_CAP) {
+    const sortedEdges = [...edges].sort((a, b) => b.weight - a.weight).slice(0, maxEdges);
+
+    const referencedIds = new Set<string>();
+    for (const edge of sortedEdges) {
+      referencedIds.add(edge.source);
+      referencedIds.add(edge.target);
+    }
+
+    nodes = snapshot.nodes.filter(n => referencedIds.has(n.id));
+    edges = sortedEdges;
+    wasCapped = true;
+  }
+
+  // Pin the DevNeural center node at origin
+  const transformedNodes = nodes.map(n => {
+    if (n.id === DEVNEURAL_CENTER_ID || n.label === DEVNEURAL_CENTER_LABEL) {
+      return { ...n, fx: 0, fy: 0, fz: 0 };
+    }
+    return n;
+  });
+
+  // Rename edges → links (all fields preserved)
+  const links: GraphLink[] = edges.map(e => ({ ...e }));
+
+  return { nodes: transformedNodes, links, wasCapped, originalCounts };
+}
+
+// ── Loading overlay ───────────────────────────────────────────────────────────
+
+function showLoading(): void {
+  if (!document.getElementById('devneural-loading')) {
+    const div = document.createElement('div');
+    div.id = 'devneural-loading';
+    div.textContent = 'Building graph...';
+    document.body.appendChild(div);
+  }
+}
+
+function hideLoading(): void {
+  document.getElementById('devneural-loading')?.remove();
+}
+
+// ── Sphere constraint force ───────────────────────────────────────────────────
+
+interface PhysicsNode {
+  id?: string | number;
+  x?: number;
+  y?: number;
+  z?: number;
+  vx?: number;
+  vy?: number;
+  vz?: number;
+  fx?: number;
+}
+
+function createSphereForce(targetRadius: number) {
+  let nodes: PhysicsNode[] = [];
+
+  function force(alpha: number): void {
+    for (const node of nodes) {
+      if (node.fx !== undefined) continue; // pinned node — skip
+
+      const x = node.x ?? 0;
+      const y = node.y ?? 0;
+      const z = node.z ?? 0;
+      const dist = Math.sqrt(x * x + y * y + z * z) || 1;
+      const k = ((dist - targetRadius) / dist) * alpha * 0.1;
+      node.vx = (node.vx ?? 0) - x * k;
+      node.vy = (node.vy ?? 0) - y * k;
+      node.vz = (node.vz ?? 0) - z * k;
+    }
+  }
+
+  force.initialize = function (n: NodeObject[]): void {
+    nodes = n as PhysicsNode[];
+  };
+
+  return force;
+}
+
+// ── Graph instance (module-level singleton) ───────────────────────────────────
+
+const graph = new ThreeForceGraph()
+  .forceEngine('d3')
+  .warmupTicks(150);
+
+graph.d3Force('sphere', createSphereForce(ORB_RADIUS) as Parameters<typeof graph.d3Force>[1]);
+graph.onFinishUpdate(() => hideLoading());
+
+export function getGraphInstance(): ThreeForceGraph {
+  return graph;
+}
+
+export function updateGraph(snapshot: GraphSnapshot): void {
+  const { nodes, links, wasCapped, originalCounts } = capAndTransform(snapshot);
+
+  if (wasCapped) {
+    console.warn(
+      `DevNeural: graph capped. Showing ${links.length} edges (of ${originalCounts.edges}) ` +
+        `and ${nodes.length} nodes (of ${originalCounts.nodes})`
+    );
+  }
+
+  showLoading();
+  requestAnimationFrame(() => {
+    graph.graphData({ nodes: nodes as unknown as NodeObject[], links: links as unknown[] });
+  });
+}
diff --git a/03-vscode-extension/webview/renderer.ts b/03-vscode-extension/webview/renderer.ts
index cf869f4..27d5edd 100644
--- a/03-vscode-extension/webview/renderer.ts
+++ b/03-vscode-extension/webview/renderer.ts
@@ -1,2 +1,53 @@
-// Implemented in section-06-threejs-scene
-export {};
+import * as THREE from 'three';
+import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
+
+export const ORB_RADIUS = 120;
+
+export function createScene(canvas: HTMLCanvasElement): {
+  scene: THREE.Scene;
+  camera: THREE.PerspectiveCamera;
+  renderer: THREE.WebGLRenderer;
+  controls: OrbitControls;
+  startAnimationLoop(onTick: (delta: number) => void): void;
+} {
+  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
+  renderer.setPixelRatio(window.devicePixelRatio);
+  renderer.setSize(canvas.clientWidth, canvas.clientHeight);
+
+  const distance = ORB_RADIUS / Math.sin((75 / 2) * (Math.PI / 180));
+  const camera = new THREE.PerspectiveCamera(75, canvas.clientWidth / canvas.clientHeight, 0.1, 10000);
+  camera.position.set(0, 0, distance);
+
+  const scene = new THREE.Scene();
+
+  scene.add(new THREE.AmbientLight(0xffffff, 0.6));
+  const dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
+  dirLight.position.set(50, 50, 50);
+  scene.add(dirLight);
+
+  scene.fog = new THREE.FogExp2(0x0a0a0f, 0.003);
+
+  const controls = new OrbitControls(camera, renderer.domElement);
+  controls.enableDamping = true;
+
+  new ResizeObserver(() => {
+    const { clientWidth: w, clientHeight: h } = canvas;
+    renderer.setSize(w, h);
+    camera.aspect = w / h;
+    camera.updateProjectionMatrix();
+  }).observe(canvas);
+
+  function startAnimationLoop(onTick: (delta: number) => void): void {
+    const clock = new THREE.Clock();
+    function frame() {
+      requestAnimationFrame(frame);
+      const delta = clock.getDelta();
+      controls.update();
+      onTick(delta);
+      renderer.render(scene, camera);
+    }
+    frame();
+  }
+
+  return { scene, camera, renderer, controls, startAnimationLoop };
+}
