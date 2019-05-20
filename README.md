# serverless-plugin-thundra
[![serverless](http://public.serverless.com/badges/v3.svg)](http://www.serverless.com)
[![npm version](https://badge.fury.io/js/serverless-plugin-thundra.svg)](https://badge.fury.io/js/serverless-plugin-thundra)

Automatically wrap your AWS Lambda functions with Thundra for the serverless framework ⚡️ https://thundra.io

Check out [Thundra docs](https://docs.thundra.io/v1.0.0/) for more information.

## Installation

```bash
npm install serverless-plugin-thundra
```

## Usage

Thundra's serverless plugin allows you to automatically wrap your **Python**, **Node.js** and **Java** Lambda functions to enable monitoring with Thundra.

Please ensure that along with this library, you also download the respective library of the Thundra agent related to the language in which you are
developing.

- For Thundra's Python agent:

```bash
pip3 install thundra -t .
```

- For Thundra's Node agent:

```bash
npm install @thundra/core --save
```

- For Thundra's Java agent, no need to install any Thundra Java dependency as Thundra Java agent comes through layer at runtime (not at build time).

After installing the respective Thundra agent and Thundra's serverless plugin with the `npm install serverless-plugin-thundra`. Add it to your serverless
plugins by including itunder the `plugins` section of your '.yml' file.

```bash
plugins:
  - serverless-plugin-thundra
```

![add-servless-plugin](./assets/thundra-serverless-plugin.gif)

Ensure that the plugin is the first plugin you add under `plugins`

## Configuration

You can configure Thundra's serverless plugin to disable specific functions, or the whole plugin in general.

### Disable Plugin:

You may disable Thundra's serverless plugin by using the `disable` variable under the `thundra` component which you added under `custom` when adding the plugin to
your '.yml' file.

```bash
custom:
  thundra:
    disable: true
```

### Disable Specific Functions:

You may disable automatic wrapping of specific functions by setting `disable` to `true`, under the `custom.thundra` for the function you want.

```bash
functions:
  hello-world-test:
    name: hello-world-test
    handler: index.handler
    custom:
      thundra:
        disable: true
```

### Defining custom `node_modules` path for functions [Node.js]
By default, plugin searches for `@thundra/core` package in the following directories, `@thundra/core` package should be available in at least one of them:

* Any directory in `modules.paths` (default search paths used by `require`)
* \<directory that contains handler file for a specific function\>/node_modules
* The directory that is given as follows:
```bash
functions:
  hello-world-test:
    name: hello-world-test
    handler: index.handler
    custom:
      thundra:
        node_modules_path: <directory that contains @thundra/core>
```

### Defining custom `package.json` path [Node.js]
By default, this plugin searches for the `package.json` file in the root serverless application directory and if the file is found, it ensures that the 
`@thundra/core` package is installed. There are repositories that use multiple `package.json` files and the default one is not the one where the module 
dependencies are defined (this is particularly common with monorepo directory structures). The `package_json_path` can be used to specify the directory 
where to look for the correct `package.json` file.

This can be defined globally as follows:
```bash
custom:
  thundra:
    package_json_path: <directory that contains correct package.json>
```

Alternatively, this can be overriden using the serverless cli argument `--prefix=<directory` or the `npm_config_prefix` environment variable.

### Specify Layer version [Java]
By default, plugin uses default Java layer version of the plugin and it might be changed by each version of plugin.
But it can be specified by configuration property in the yml file globally and/or function based.

**Globally:**
```bash
custom:
  thundra:
    java:
      layer:
        version: <layer version of the Java agent>
```

**For per function:**
```bash
functions:
  hello-world-test:
    name: hello-world-test
    handler: com.mycompany.HelloWorlHandler
    custom:
      thundra:
        java:
          layer:
            version: <layer version of the Java agent>
```
