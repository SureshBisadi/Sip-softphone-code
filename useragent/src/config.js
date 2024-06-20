const configParams = {
  freeswitch: {
    ip: "10.16.7.11",
    port: 8021,
    password: "ClueCon"
  }
};

const getConfig = (module) => (configParams[module] !== undefined ? configParams[module] : {});

exports.getConfig = getConfig;
