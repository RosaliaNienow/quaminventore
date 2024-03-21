const test = require("ava");
const Web3EthAbi = require("web3-eth-abi");
const root = require("path").join.bind(this, __dirname, "..");
require("dotenv").config({ path: root(".test.env") });

const {
  Abi,
  Godwoker,
  serializeAbiItem,
  deserializeAbiItem,
} = require("../lib/index");

const TEST_ABI_ITEMS = [
  {
    inputs: [{ type: "address", name: "" }],
    constant: true,
    name: "isInstantiation",
    payable: false,
    outputs: [{ type: "bool", name: "" }],
    type: "function",
  },
  {
    inputs: [
      { type: "address[]", name: "_owners" },
      { type: "uint256", name: "_required" },
      { type: "uint256", name: "_dailyLimit" },
    ],
    constant: false,
    name: "create",
    payable: false,
    outputs: [{ type: "address", name: "wallet" }],
    type: "function",
  },
  {
    inputs: [
      { type: "address", name: "" },
      { type: "uint256", name: "" },
    ],
    constant: true,
    name: "instantiations",
    payable: false,
    outputs: [{ type: "address", name: "" }],
    type: "function",
  },
  {
    inputs: [{ type: "address", name: "creator" }],
    constant: true,
    name: "getInstantiationCount",
    payable: false,
    outputs: [{ type: "uint256", name: "" }],
    type: "function",
  },
  {
    inputs: [
      { indexed: false, type: "address", name: "sender" },
      { indexed: false, type: "address", name: "instantiation" },
    ],
    type: "event",
    name: "ContractInstantiation",
    anonymous: false,
  },
];
var godwoker;
var abi;

test.before(async (t) => {
  // init abi and godwoker
  const godwoken_rpc_url = process.env.WEB3_JSON_RPC;
  const provider_config = {
    godwoken: {
      rollup_type_hash: process.env.ROLLUP_TYPE_HASH,
      eth_account_lock: {
        code_hash: process.env.ETH_ACCOUNT_LOCK_CODE_HASH,
        hash_type: "type",
      },
    },
  };
  abi = new Abi(TEST_ABI_ITEMS);
  godwoker = new Godwoker(godwoken_rpc_url, provider_config);
  await godwoker.init();
});

test.serial("serialize abi item", (t) => {
  const abi_item = {
    inputs: [
      { type: "address[]", name: "_owners" },
      { type: "uint256", name: "_required" },
      { type: "uint256", name: "_dailyLimit" },
    ],
    constant: false,
    name: "create",
    payable: false,
    outputs: [{ type: "address", name: "wallet" }],
    type: "function",
  };
  const serialize_abi = serializeAbiItem(abi_item);
  t.is(serialize_abi.slice(0, 2), "0x");
  const deserialize_abi = deserializeAbiItem(serialize_abi);
  //t.deepEqual(deserialize_abi, abi_item);
  t.is(deserialize_abi.name, abi_item.name);
});

test.serial("get_interested_methods", (t) => {
  const methods = abi.get_interested_methods();
  t.is(methods.length, 4);
});

test.serial("decode method", (t) => {
  const testData =
    "0x53d9d9100000000000000000000000000000000000000000000000000000000000000060000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000002000000000000000000000000a6d9c5f7d4de3cef51ad3b7235d79ccc95114de5000000000000000000000000a6d9c5f7d4de3cef51ad3b7235d79ccc95114daa";
  const decodedData = abi.decode_method(testData);
  t.deepEqual(decodedData.params[0].value, [
    "0xa6d9c5f7d4de3cef51ad3b7235d79ccc95114de5",
    "0xa6d9c5f7d4de3cef51ad3b7235d79ccc95114daa",
  ]);
});

test.serial("refactor eth-address in inputs", async (t) => {
  const testData =
    "0x53d9d9100000000000000000000000000000000000000000000000000000000000000060000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000002000000000000000000000000a6d9c5f7d4de3cef51ad3b7235d79ccc95114de5000000000000000000000000a6d9c5f7d4de3cef51ad3b7235d79ccc95114daa";
  const decodedData = abi.decode_method(testData);
  const newTestData = await abi.refactor_data_with_short_address(
    testData,
    godwoker.getShortAddressByAllTypeEthAddress.bind(godwoker)
  );
  const newDecodedData = abi.decode_method(newTestData);
  t.not(testData, newTestData);
  t.notDeepEqual(decodedData, newDecodedData);
});

test.serial("refactor eth-address in outputs", async (t) => {
  const abi_item = {
    inputs: [
      { type: "address[]", name: "_owners" },
      { type: "uint256", name: "_required" },
      { type: "uint256", name: "_dailyLimit" },
    ],
    constant: false,
    name: "create",
    payable: false,
    outputs: [{ type: "address", name: "wallet" }],
    type: "function",
  };

  const eth_address = await godwoker.getPolyjuiceDefaultFromAddress();
  const short_address = godwoker
    .computeScriptHashByEoaEthAddress(eth_address)
    .slice(0, 42);
  const test_values = Web3EthAbi.encodeParameters(["address"], [short_address]);
  const output_value_types = abi_item.outputs.map((item) => item.type);
  const decoded_values = Web3EthAbi.decodeParameters(
    output_value_types,
    test_values
  );
  const new_test_values = await abi.refactor_return_value_with_short_address(
    test_values,
    abi_item,
    godwoker.getEthAddressByAllTypeShortAddress.bind(godwoker)
  );
  const new_decoded_values = Web3EthAbi.decodeParameters(
    output_value_types,
    new_test_values
  );
  t.not(decoded_values[0], new_decoded_values[0]);
});

test.serial("refactor default 0x00 address in inputs", async (t) => {
  const testData =
    "0x53d9d91000000000000000000000000000000000000000000000000000000000000000600000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000000000000000000000000000000a6d9c5f7d4de3cef51ad3b7235d79ccc95114daa";
  const decodedData = abi.decode_method(testData);
  const newTestData = await abi.refactor_data_with_short_address(
    testData,
    godwoker.getShortAddressByAllTypeEthAddress.bind(godwoker)
  );
  const newDecodedData = abi.decode_method(newTestData);
  t.is(
    decodedData.params[0].value[0],
    "0x0000000000000000000000000000000000000000"
  );
  t.is(
    decodedData.params[0].value[1],
    "0xa6d9c5f7d4de3cef51ad3b7235d79ccc95114daa"
  );
  t.not(testData, newTestData);
  t.notDeepEqual(decodedData, newDecodedData);
});

test.serial("refactor default 0x00 in outputs", async (t) => {
  const abi_item = {
    inputs: [
      { type: "address[]", name: "_owners" },
      { type: "uint256", name: "_required" },
      { type: "uint256", name: "_dailyLimit" },
    ],
    constant: false,
    name: "create",
    payable: false,
    outputs: [{ type: "address", name: "wallet" }],
    type: "function",
  };

  const test_values = Web3EthAbi.encodeParameters(
    ["address"],
    ["0x0000000000000000000000000000000000000000"]
  );
  const output_value_types = abi_item.outputs.map((item) => item.type);
  const decoded_values = Web3EthAbi.decodeParameters(
    output_value_types,
    test_values
  );
  const new_test_values = await abi.refactor_return_value_with_short_address(
    test_values,
    abi_item,
    godwoker.getEthAddressByAllTypeShortAddress.bind(godwoker)
  );
  const new_decoded_value = Web3EthAbi.decodeParameters(
    output_value_types,
    new_test_values
  );
  t.is(decoded_values[0], "0x0000000000000000000000000000000000000000");
  t.is(new_decoded_value[0], "0x0000000000000000000000000000000000000000");
});
