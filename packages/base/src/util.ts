import { Script, Hash, utils, HexNumber, HexString } from "@ckb-lumos/base";
import {
  GodwokenUtils,
  RawL2Transaction,
  L2Transaction,
  RunResult,
  TransactionReceipt as GwTransactionReceipt,
} from "@polyjuice-provider/godwoken";
import {
  SerializeSUDTArgs,
  SerializeL2Transaction,
  SerializeRawL2Transaction,
} from "@polyjuice-provider/godwoken/schemas";
import {
  AddressMapping,
  RawL2TransactionWithAddressMapping,
  L2TransactionWithAddressMapping,
  AddressMappingItem,
} from "@polyjuice-provider/godwoken/lib/addressTypes";
import {
  SerializeAddressMapping,
  SerializeL2TransactionWithAddressMapping,
  SerializeRawL2TransactionWithAddressMapping,
  L2TransactionWithAddressMapping as L2TransactionWithAddressMappingClass,
  RawL2TransactionWithAddressMapping as RawL2TransactionWithAddressMappingClass,
  AddressMapping as AddressMappingClass,
} from "@polyjuice-provider/godwoken/schemas/addressMapping/addressMapping";
import {
  UnionType,
  SUDTTransfer,
  NormalizeSUDTTransfer,
  NormalizeL2Transaction,
  NormalizeAddressMapping,
  NormalizeL2TransactionWithAddressMapping,
  NormalizeRawL2Transaction,
  NormalizeRawL2TransactionWithAddressMapping,
} from "@polyjuice-provider/godwoken/lib/normalizer";
import {
  U128_MIN,
  U128_MAX,
  DEFAULT_EMPTY_ETH_ADDRESS,
  HEX_CHARACTERS,
  POLY_MAX_TRANSACTION_GAS_LIMIT,
  POLY_MIN_GAS_PRICE,
  EMPTY_ABI_ITEM_SERIALIZE_STR,
  WAIT_TIMEOUT_MILSECS,
  WAIT_LOOP_INTERVAL_MILSECS,
  DEFAULT_ETH_TO_CKB_SUDT_DECIMAL,
} from "./constant";
import { Reader } from "ckb-js-toolkit";
import crossFetch from "cross-fetch"; // for nodejs compatibility polyfill
import { Buffer } from "buffer"; // for browser compatibility polyfill
import { ShortAddress, ShortAddressType, SigningMessageType } from "./types";

// replace for buffer polyfill under 0.6 version.
// eg: for react project using webpack 4 (this is the most common case when created by running `npx create-react-app`),
// the default react-scripts config just use buffer@0.4.3 which doesn't include writeBigUint64LE function.
// code copy from https://github.com/feross/buffer/blob/master/index.js#L1497-L1513
function writeBigUint64LE(buf: any, value: any, offset = 0) {
  let lo = Number(value & BigInt(0xffffffff));
  buf[offset++] = lo;
  lo = lo >> 8;
  buf[offset++] = lo;
  lo = lo >> 8;
  buf[offset++] = lo;
  lo = lo >> 8;
  buf[offset++] = lo;
  let hi = Number((value >> BigInt(32)) & BigInt(0xffffffff));
  buf[offset++] = hi;
  hi = hi >> 8;
  buf[offset++] = hi;
  hi = hi >> 8;
  buf[offset++] = hi;
  hi = hi >> 8;
  buf[offset++] = hi;
  return offset;
}

Buffer.prototype.writeBigUInt64LE = function (value, offset) {
  return writeBigUint64LE(this, value, offset);
};

const jaysonBrowserClient = require("jayson/lib/client/browser");

declare global {
  interface Window {
    fetch: any;
  }
}

const fetch = typeof window !== "undefined" ? window.fetch : crossFetch;

export interface EthTransactionReceipt {
  transactionHash: Hash;
  blockHash: Hash;
  blockNumber: HexNumber;
  transactionIndex: HexNumber;
  gasUsed: HexNumber;
  cumulativeGasUsed: HexNumber;
  logsBloom: HexString;
  logs: EthLogItem[];
  contractAddress: HexString;
  status: EthTransactionStatus;
}

export interface EthLogItem {
  address: HexString;
  blockHash: Hash;
  blockNumber: HexNumber;
  transactionIndex: HexNumber;
  transactionHash: Hash;
  data: HexString;
  logIndex: HexNumber;
  topics: HexString[];
  removed: boolean;
}

export enum EthTransactionStatus {
  success = "0x1",
  failure = "0x0",
}

export type EthAddress = HexString;

export type EthTransaction = {
  from: HexString;
  to: HexString;
  gas?: HexNumber;
  gasPrice?: HexNumber;
  value: HexNumber;
  data: HexString;
  nonce?: HexNumber;
};

export type InformalEthTransaction = {
  from?: HexString;
  to?: HexString;
  gas?: HexNumber | bigint | number;
  gasLimit?: HexNumber | bigint | number;
  gasPrice?: HexNumber | bigint | number;
  value?: HexNumber | bigint | number;
  data?: HexString;
  nonce?: HexNumber | bigint | number;
};

export type L2TransactionArgs = {
  to_id: number;
  value: bigint;
  data: HexString;
};

export type GodwokerOption = {
  godwoken?: {
    rollup_type_hash?: Hash;
    eth_account_lock?: Omit<Script, "args">;
  };
  polyjuice?: {
    creator_id?: HexNumber;
    default_from_address?: HexString;
  };
  queryEthAddressByShortAddress?: (short_address: string) => string;
  saveEthAddressShortAddressMapping?: (
    eth_address: string,
    short_address: string
  ) => void;
  request_option?: object;
};

export type RequestRpcResult = {
  err: any;
  data?: string;
};

export enum RequireResult {
  canBeEmpty,
  canNotBeEmpty,
}

export enum GetTxVerbose {
  TxWithStatus = 0,
  OnlyStatus = 1,
}

export enum L2TransactionStatus {
  Pending,
  Committed,
}

export interface L2TransactionView {
  inner: L2Transaction;
  tx_hash: HexString;
}

export interface L2TransactionWithStatus {
  transaction: L2TransactionView | null;
  status: L2TransactionStatus;
}

export function formalizeEthToAddress(to_address: string | undefined | null) {
  if (to_address === "0x") return DEFAULT_EMPTY_ETH_ADDRESS;

  if (!to_address) return DEFAULT_EMPTY_ETH_ADDRESS;

  if (typeof to_address === "string" && to_address.length !== 42)
    throw new Error(`invalid ETH to_address length ${to_address.length}.`);

  if (typeof to_address !== "string")
    throw new Error(`invalid type of to_address ${typeof to_address}`);

  return to_address;
}

export function verifyHttpUrl(_url: string) {
  const url = new URL(_url);
  if (url.protocol === "https:" || url.protocol === "http:") {
    return true;
  }

  return false;
}

export function isHexString(value: any, length?: number): boolean {
  if (typeof value !== "string" || !value.match(/^0x[0-9A-Fa-f]*$/)) {
    return false;
  }
  if (length && value.length !== 2 + 2 * length) {
    return false;
  }
  return true;
}

export function normalizeHexValue(
  value: HexNumber | bigint | number
): HexString {
  if (typeof value === "number") {
    let hex = "";
    while (value) {
      hex = HEX_CHARACTERS[value & 0xf] + hex;
      value = Math.floor(value / 16);
    }

    if (hex.length) {
      if (hex.length % 2) {
        hex = "0" + hex;
      }
      return "0x" + hex;
    }

    return "0x00";
  }

  if (typeof value === "bigint") {
    value = value.toString(16);
    if (value.length % 2) {
      return "0x0" + value;
    }
    return "0x" + value;
  }

  if (isHexString(value)) {
    if ((<string>value).length % 2) {
      value = "0x0" + (<string>value).substring(2);
    }
    return (<string>value).toLowerCase();
  }

  throw new Error(`invalid hexlify value type ${value}`);
}

export function normalizeEthTransaction(tx: InformalEthTransaction) {
  if (!tx.from || typeof tx.from !== "string") {
    throw new Error("missing From in Transaction!");
  }

  return {
    from: tx.from,
    to: formalizeEthToAddress(tx.to),
    gas: normalizeHexValue(
      tx.gas || tx.gasLimit || POLY_MAX_TRANSACTION_GAS_LIMIT
    ),
    gasPrice: normalizeHexValue(tx.gasPrice || POLY_MIN_GAS_PRICE),
    value: normalizeHexValue(tx.value || "0x00"),
    data: normalizeHexValue(tx.data || "0x00"),
  };
}

export function serializeAddressMapping(
  addressMapping: AddressMapping
): HexString {
  const _tx = NormalizeAddressMapping(addressMapping);
  return new Reader(SerializeAddressMapping(_tx)).serializeJson();
}

export function deserializeAddressMapping(value: HexString): AddressMapping {
  const data = new AddressMappingClass(new Reader(value));
  const addresses_len =
    "0x" + data.getLength().toLittleEndianUint32().toString(16);
  const addresses_len_in_int = parseInt(addresses_len);
  return {
    length: addresses_len,
    data: [...Array(addresses_len_in_int).keys()].map((index) => {
      return {
        eth_address: new Reader(
          data.getData().indexAt(index).getEthAddress().raw()
        ).serializeJson(),
        gw_short_address: new Reader(
          data.getData().indexAt(index).getGwShortAddress().raw()
        ).serializeJson(),
      };
    }),
  };
}

export function serializeRawL2TransactionWithAddressMapping(
  rawL2TransactionWithAddressMapping: RawL2TransactionWithAddressMapping
): HexString {
  const _tx = NormalizeRawL2TransactionWithAddressMapping(
    rawL2TransactionWithAddressMapping
  );
  return new Reader(
    SerializeRawL2TransactionWithAddressMapping(_tx)
  ).serializeJson();
}

export function deserializeRawL2TransactionWithAddressMapping(
  value: HexString
): RawL2TransactionWithAddressMapping {
  const data = new RawL2TransactionWithAddressMappingClass(new Reader(value));
  const address_length =
    "0x" + data.getAddresses().getLength().toLittleEndianUint32().toString(16);
  const address_length_in_int = parseInt(address_length);
  const raw_tx = {
    from_id:
      "0x" + data.getRawTx().getFromId().toLittleEndianUint32().toString(16),
    to_id: "0x" + data.getRawTx().getToId().toLittleEndianUint32().toString(16),
    args: new Reader(data.getRawTx().getArgs().raw()).serializeJson(),
    nonce:
      "0x" + data.getRawTx().getNonce().toLittleEndianUint32().toString(16),
  };
  const addressMapping = {
    length: address_length,
    data: [...Array(address_length_in_int).keys()].map((index) => {
      return {
        eth_address: new Reader(
          data.getAddresses().getData().indexAt(index).getEthAddress().raw()
        ).serializeJson(),
        gw_short_address: new Reader(
          data.getAddresses().getData().indexAt(index).getGwShortAddress().raw()
        ).serializeJson(),
      };
    }),
  };
  const rawL2TransactionWithAddressMapping: RawL2TransactionWithAddressMapping =
    {
      raw_tx: raw_tx,
      addresses: addressMapping,
      extra: new Reader(data.getExtra().raw()).serializeJson(),
    };
  return rawL2TransactionWithAddressMapping;
}

export function serializeL2TransactionWithAddressMapping(
  l2TransactionWithAddressMapping: L2TransactionWithAddressMapping
): HexString {
  const _tx = NormalizeL2TransactionWithAddressMapping(
    l2TransactionWithAddressMapping
  );
  return new Reader(
    SerializeL2TransactionWithAddressMapping(_tx)
  ).serializeJson();
}

export function deserializeL2TransactionWithAddressMapping(
  value: HexString
): L2TransactionWithAddressMapping {
  const data = new L2TransactionWithAddressMappingClass(new Reader(value));
  const address_length =
    "0x" + data.getAddresses().getLength().toLittleEndianUint32().toString(16);
  const address_length_in_int = parseInt(address_length);
  const tx: L2Transaction = {
    raw: {
      from_id:
        "0x" +
        data.getTx().getRaw().getFromId().toLittleEndianUint32().toString(16),
      to_id:
        "0x" +
        data.getTx().getRaw().getToId().toLittleEndianUint32().toString(16),
      args: new Reader(data.getTx().getRaw().getArgs().raw()).serializeJson(),
      nonce:
        "0x" +
        data.getTx().getRaw().getNonce().toLittleEndianUint32().toString(16),
    },
    signature: new Reader(data.getTx().getSignature().raw()).serializeJson(),
  };
  const addressMapping = {
    length: address_length,
    data: [...Array(address_length_in_int).keys()].map((index) => {
      return {
        eth_address: new Reader(
          data.getAddresses().getData().indexAt(index).getEthAddress().raw()
        ).serializeJson(),
        gw_short_address: new Reader(
          data.getAddresses().getData().indexAt(index).getGwShortAddress().raw()
        ).serializeJson(),
      };
    }),
  };
  const rawL2TransactionWithAddressMapping: L2TransactionWithAddressMapping = {
    tx: tx,
    addresses: addressMapping,
    extra: new Reader(data.getExtra().raw()).serializeJson(),
  };
  return rawL2TransactionWithAddressMapping;
}

export function buildL2TransactionWithAddressMapping(
  tx: L2Transaction,
  addressMappingItemVec: AddressMappingItem[],
  abiItem?: HexString
): L2TransactionWithAddressMapping {
  const addressMapping: AddressMapping = {
    length: "0x" + addressMappingItemVec.length.toString(16),
    data: addressMappingItemVec,
  };
  return {
    tx: tx,
    addresses: addressMapping,
    extra: abiItem || EMPTY_ABI_ITEM_SERIALIZE_STR,
  };
}

export function buildRawL2TransactionWithAddressMapping(
  tx: RawL2Transaction,
  addressMappingItemVec: AddressMappingItem[],
  abiItem?: HexString
): RawL2TransactionWithAddressMapping {
  const addressMapping: AddressMapping = {
    length: "0x" + addressMappingItemVec.length.toString(16),
    data: addressMappingItemVec,
  };
  return {
    raw_tx: tx,
    addresses: addressMapping,
    extra: abiItem || EMPTY_ABI_ITEM_SERIALIZE_STR,
  };
}

export function serializeL2Transaction(tx: L2Transaction): HexString {
  const _tx = NormalizeL2Transaction(tx);
  return new Reader(SerializeL2Transaction(_tx)).serializeJson();
}

export function serializeRawL2Transaction(tx: RawL2Transaction): HexString {
  const _tx = NormalizeRawL2Transaction(tx);
  return new Reader(SerializeRawL2Transaction(_tx)).serializeJson();
}

export function decodeArgs(_args: HexString) {
  const args = _args.slice(2);
  const args_0_7 = "0x" + args.slice(0, 14);
  const args_7 = "0x" + args.slice(14, 16);
  const args_8_16 = "0x" + args.slice(16, 32);
  const args_16_32 = "0x" + args.slice(32, 64);
  const args_32_48 = "0x" + args.slice(64, 96);
  const args_48_52 = "0x" + args.slice(96, 104);
  const args_data = "0x" + args.slice(104);

  const header = Buffer.from(args_0_7.slice(8), "hex").toString("utf-8");
  const type = args_7;
  const gas_limit = "0x" + LeBytesToUInt64(args_8_16).toString(16);
  const gas_price = "0x" + LeBytesToUInt128(args_16_32).toString(16);
  const value = "0x" + LeBytesToUInt128(args_32_48).toString(16);
  const data_length = "0x" + LeBytesToUInt32(args_48_52).toString(16);
  const data = args_data;

  return { header, type, gas_limit, gas_price, value, data_length, data };
}

export function encodeArgs(_tx: EthTransaction) {
  const { to, gasPrice, gas: gasLimit, value, data } = _tx;

  // header
  const args_0_7 =
    "0x" +
    Buffer.from("FFFFFF", "hex").toString("hex") +
    Buffer.from("POLY", "utf8").toString("hex");

  // gas limit
  const args_8_16 = UInt64ToLeBytes(BigInt(gasLimit!));
  // gas price
  const args_16_32 = UInt128ToLeBytes(
    gasPrice === "0x" ? BigInt(0) : BigInt(gasPrice!)
  );
  // value
  const args_32_48 = UInt128ToLeBytes(
    value === "0x" ? BigInt(0) : BigInt(value)
  );

  const dataByteLength = Buffer.from(data.slice(2), "hex").length;
  // data length
  const args_48_52 = UInt32ToLeBytes(dataByteLength);
  // data
  const args_data = data;

  let args_7 = "";
  if (to === DEFAULT_EMPTY_ETH_ADDRESS || to === "0x" || to === "0x0") {
    args_7 = "0x03";
  } else {
    args_7 = "0x00";
  }

  const args =
    "0x" +
    args_0_7.slice(2) +
    args_7.slice(2) +
    args_8_16.slice(2) +
    args_16_32.slice(2) +
    args_32_48.slice(2) +
    args_48_52.slice(2) +
    args_data.slice(2);

  return args;
}

export function encodeSudtTransferArgs(
  toAddress: HexString,
  amount: bigint,
  fee: bigint
) {
  const sudtTransfer: SUDTTransfer = {
    to: toAddress,
    amount: "0x" + amount.toString(16),
    fee: "0x" + fee.toString(16),
  };
  const sudtArgs: UnionType = {
    type: "SUDTTransfer",
    value: NormalizeSUDTTransfer(sudtTransfer),
  };
  const serializedSudtArgs = new Reader(
    SerializeSUDTArgs(sudtArgs)
  ).serializeJson();
  return serializedSudtArgs;
}

export function ethToCkb(
  value: HexString,
  decimal = DEFAULT_ETH_TO_CKB_SUDT_DECIMAL
) {
  return BigInt(value) / BigInt(decimal);
}

export function ckbToEth(
  value: HexString,
  decimal = DEFAULT_ETH_TO_CKB_SUDT_DECIMAL
) {
  return BigInt(value) * BigInt(decimal);
}

export class Godwoker {
  public eth_account_lock: Omit<Script, "args"> | undefined;
  public rollup_type_hash: string | undefined;
  public creator_id: HexNumber | undefined;
  public default_from_address: HexString | undefined;
  public client: any;
  public godwokenUtils: GodwokenUtils;
  public queryEthAddressByShortAddress;
  public saveEthAddressShortAddressMapping;

  constructor(host: string, option?: GodwokerOption) {
    const callServer = function (request: any, callback: any) {
      const opt = option?.request_option || {
        method: "POST",
        body: request,
        headers: {
          "Content-Type": "application/json",
        },
      };
      fetch(host, opt)
        .then(function (res: Response) {
          return res.text();
        })
        .then(function (text: Response) {
          callback(null, text);
        })
        .catch(function (err: Error) {
          callback(err);
        });
    };
    this.client = jaysonBrowserClient(callServer);
    this.godwokenUtils = new GodwokenUtils(option?.godwoken?.rollup_type_hash);
    this.eth_account_lock = option?.godwoken?.eth_account_lock;
    this.rollup_type_hash = option?.godwoken?.rollup_type_hash;
    this.creator_id = option?.polyjuice?.creator_id;
    this.default_from_address = option?.polyjuice?.default_from_address;
    this.queryEthAddressByShortAddress = option?.queryEthAddressByShortAddress;
    this.saveEthAddressShortAddressMapping =
      option?.saveEthAddressShortAddressMapping;
  }

  // call init if you haven't pass rollup configs to constructor
  async init(): Promise<void> {
    if (!this.rollup_type_hash) {
      this.rollup_type_hash = await this.getRollupTypeHash();
    }

    if (!this.eth_account_lock?.code_hash) {
      this.eth_account_lock = {
        code_hash: await this.getEthAccountLockHash(),
        hash_type: "type",
      };
    }

    if (!this.creator_id) {
      this.creator_id = await this.getPolyjuiceCreatorAccountId();
    }

    if (!this.default_from_address) {
      this.default_from_address = await this.getPolyjuiceDefaultFromAddress();
    }

    if (!this.godwokenUtils.rollupTypeHash) {
      this.godwokenUtils = new GodwokenUtils(this.rollup_type_hash);
    }
  }

  initSync(): Promise<void> {
    const that = this;
    const rollupPromise = () => {
      return this.rollup_type_hash
        ? this.rollup_type_hash
        : this.getRollupTypeHash();
    };
    const ethAccountPromise = () => {
      return this.eth_account_lock?.code_hash
        ? this.eth_account_lock?.code_hash
        : this.getEthAccountLockHash();
    };
    const creatorIdPromise = () => {
      return this.creator_id
        ? this.creator_id
        : this.getPolyjuiceCreatorAccountId();
    };
    const defaultFromAddressPromise = () => {
      return this.default_from_address
        ? this.default_from_address
        : this.getPolyjuiceDefaultFromAddress();
    };

    return Promise.all([
      rollupPromise(),
      ethAccountPromise(),
      creatorIdPromise(),
      defaultFromAddressPromise(),
    ])
      .then(function (args) {
        that.rollup_type_hash = args[0];
        that.eth_account_lock = {
          code_hash: args[1],
          hash_type: "type",
        };
        that.creator_id = args[2];
        that.default_from_address = args[3];
        if (!that.godwokenUtils.rollupTypeHash)
          that.godwokenUtils = new GodwokenUtils(that.rollup_type_hash);

        return Promise.resolve();
      })
      .catch(function (err) {
        return Promise.reject(err);
      });
  }

  packSignature(_signature: HexString): HexString {
    let v = Number.parseInt(_signature.slice(-2), 16);
    if (v >= 27) v -= 27;
    const signature = _signature.slice(0, -2) + v.toString(16).padStart(2, "0");
    return signature;
  }

  async jsonRPC(
    method: string,
    params: any[],
    _errMsgWhenNoResult?: string | null,
    requireResult = RequireResult.canNotBeEmpty
  ): Promise<any> {
    const errMsgWhenNoResult = _errMsgWhenNoResult || "";
    const errWhenNoResult = new Error(
      `result from jsonRPC ${method} is null or undefined. ${errMsgWhenNoResult}`
    );
    return new Promise((resolve, reject) => {
      this.client.request(method, params, (err: any, res: any) => {
        if (err) return reject(err);
        if (!res) return reject(new Error("Rpc Response not found!"));
        if (res.error) return reject(res.error);
        if (requireResult === RequireResult.canBeEmpty)
          return resolve(res.result); // here result might be non-exist
        if (res.result === undefined || res.result === null)
          return reject(errWhenNoResult);
        return resolve(res.result);
      });
    });
  }

  computeScriptHashByEoaEthAddress(eth_address: string): HexString {
    const layer2_lock: Script = {
      code_hash: this.eth_account_lock?.code_hash || "",
      hash_type: this.eth_account_lock?.hash_type as "type" | "data",
      args: this.rollup_type_hash + eth_address.slice(2),
    };
    const lock_hash = utils.computeScriptHash(layer2_lock);
    return lock_hash;
  }

  async getScriptByScriptHash(_script_hash: string): Promise<Script> {
    const errorWhenNoResult = `unable to fetch script from ${_script_hash}`;
    return this.jsonRPC("gw_get_script", [_script_hash], errorWhenNoResult);
  }

  async getScriptHashByAccountId(account_id: number): Promise<HexString> {
    const errorWhenNoResult = `unable to fetch account script hash from 0x${BigInt(
      account_id
    ).toString(16)}`;
    return this.jsonRPC(
      "gw_get_script_hash",
      [`0x${BigInt(account_id).toString(16)}`],
      errorWhenNoResult
    );
  }

  async getAccountIdByScriptHash(script_hash: string): Promise<HexNumber> {
    const errorWhenNoResult = `unable to fetch account id from script hash ${script_hash}`;
    return this.jsonRPC(
      "gw_get_account_id_by_script_hash",
      [script_hash],
      errorWhenNoResult
    );
  }

  async getAccountIdByEoaEthAddress(eth_address: string): Promise<HexNumber> {
    const layer2_lock: Script = {
      code_hash: this.eth_account_lock?.code_hash || "",
      hash_type: this.eth_account_lock?.hash_type as "type" | "data",
      args: this.rollup_type_hash + eth_address.slice(2),
    };
    const lock_hash = utils.computeScriptHash(layer2_lock);
    const errorWhenNoResult = `unable to fetch account id from ${eth_address}, lock_hash is ${lock_hash}`;
    return this.jsonRPC(
      "gw_get_account_id_by_script_hash",
      [lock_hash],
      errorWhenNoResult
    );
  }

  async getScriptHashByShortAddress(
    _address: string,
    requireResult = RequireResult.canNotBeEmpty
  ): Promise<HexString> {
    const errorWhenNoResult = `unable to fetch script from ${_address}`;
    return this.jsonRPC(
      "gw_get_script_hash_by_short_address",
      [_address],
      errorWhenNoResult,
      requireResult
    );
  }

  computeShortAddressByEoaEthAddress(_address: string): HexString {
    const short_address = this.computeScriptHashByEoaEthAddress(_address).slice(
      0,
      42
    );
    return short_address;
  }

  async getShortAddressByAllTypeEthAddress(
    _address: string
  ): Promise<ShortAddress> {
    // todo: support create2 address in such case that it haven't create real contract yet.

    if (_address === DEFAULT_EMPTY_ETH_ADDRESS) {
      // special case: 0x0000...
      // todo: right now we keep the 0x00000.., later maybe should convert to polyjuice creator short address?
      return {
        value: _address,
        type: ShortAddressType.creatorAddress,
      };
    }

    try {
      // assume it is an contract address (thus already an short address)
      const isContractAddress = await this.isShortAddressOnChain(_address);
      if (isContractAddress) {
        return {
          value: _address,
          type: ShortAddressType.contractAddress,
        };
      }

      // script hash not exist with short address, assume it is EOA address..
      const short_addr = this.computeShortAddressByEoaEthAddress(_address);
      const is_eoa_exist = await this.isShortAddressOnChain(short_addr);
      if (is_eoa_exist) {
        return {
          value: short_addr,
          type: ShortAddressType.eoaAddress,
        };
      }

      // not exist eoa address:
      // remember to save the script and eoa address mapping with user-specific callback function
      if (this.saveEthAddressShortAddressMapping) {
        this.saveEthAddressShortAddressMapping(_address, short_addr);
      }
      return {
        value: short_addr,
        type: ShortAddressType.notExistEoaAddress,
      };
    } catch (error: any) {
      throw new Error(error.message);
    }
  }

  async getEthAddressByAllTypeShortAddress(
    _short_address: HexString
  ): Promise<HexString> {
    // todo: support create2 address in such case which it haven't create real contract yet.

    if (_short_address === DEFAULT_EMPTY_ETH_ADDRESS) {
      // special case: 0x0000...
      // todo: right now we keep the 0x00000.., later maybe should convert to polyjuice creator short address?
      return _short_address;
    }

    // first, query on-chain
    const is_address_on_chain = await this.isShortAddressOnChain(
      _short_address
    );
    if (is_address_on_chain) {
      const script_hash = await this.getScriptHashByShortAddress(
        _short_address
      );
      const script = await this.getScriptByScriptHash(script_hash);

      if (script.code_hash === this.eth_account_lock?.code_hash) {
        // eoa address
        return "0x" + script.args.slice(66, 106);
      }
      // assume it is contract address
      return _short_address;
    }

    // not on-chain, assume it is eoa address which haven't create account on godwoken yet
    const query_callback = this.queryEthAddressByShortAddress
      ? this.queryEthAddressByShortAddress
      : this.defaultQueryEthAddressByShortAddress.bind(this);
    const eth_address = await query_callback(_short_address);
    // check address and short_address indeed matched.
    if (this.checkEthAddressIsEoa(eth_address, _short_address)) {
      return eth_address;
    }
    throw Error(
      `query result of eoa address ${_short_address} with ${_short_address} is not match!`
    );
  }

  async isShortAddressOnChain(
    short_address: HexString,
    scriptHashCallback?: (script_hash: HexString) => void
  ): Promise<boolean> {
    scriptHashCallback =
      scriptHashCallback || function (_script_hash: HexString) {};
    try {
      const script_hash = await this.getScriptHashByShortAddress(
        short_address,
        RequireResult.canBeEmpty
      );
      if (script_hash) {
        scriptHashCallback(script_hash);
        return true;
      }
      // not exist on chain
      return false;
    } catch (error: any) {
      throw new Error(error.message);
    }
  }

  // re-compute the eth address with code_hash info to make sure
  // it indeed match with short_address
  checkEthAddressIsEoa(
    eth_address: string,
    _target_short_address: string
  ): boolean {
    const source_short_address =
      this.computeShortAddressByEoaEthAddress(eth_address);
    return (
      source_short_address.toLowerCase() === _target_short_address.toLowerCase()
    );
  }

  // default method
  async defaultQueryEthAddressByShortAddress(
    _short_address: string
  ): Promise<HexString> {
    const errorWhenNoResult = `unable to fetch eth address from ${_short_address}`;
    return this.jsonRPC(
      "poly_getEthAddressByGodwokenShortAddress",
      [_short_address],
      errorWhenNoResult
    );
  }

  async getNonce(account_id: number): Promise<HexNumber> {
    const errorWhenNoResult = `unable to fetch nonce, account_id: ${account_id}}`;
    return this.jsonRPC(
      "gw_get_nonce",
      [`0x${account_id.toString(16)}`],
      errorWhenNoResult
    );
  }

  async assembleRawL2Transaction(
    eth_tx: EthTransaction
  ): Promise<RawL2Transaction> {
    const from = await this.getAccountIdByEoaEthAddress(eth_tx.from);
    const to = await this.allTypeEthAddressToAccountId(eth_tx.to);
    const nonce = await this.getNonce(parseInt(from));
    const encodedArgs = encodeArgs(eth_tx);
    const tx: RawL2Transaction = {
      from_id: "0x" + BigInt(from).toString(16),
      to_id: "0x" + BigInt(to).toString(16),
      args: encodedArgs,
      nonce: "0x" + BigInt(nonce).toString(16),
    };
    return tx;
  }

  generateTransactionMessageToSign(
    tx: RawL2Transaction,
    sender_script_hash: string,
    receiver_script_hash: string,
    is_add_prefix_in_signing_message: boolean = false
  ): string {
    return this.godwokenUtils.generateTransactionMessageToSign(
      tx,
      sender_script_hash,
      receiver_script_hash,
      is_add_prefix_in_signing_message
    );
  }

  async generateMessageFromRawL2Transaction(
    rawL2Tx: RawL2Transaction,
    msg_type: SigningMessageType = SigningMessageType.withPrefix
  ) {
    const sender_script_hash = await this.getScriptHashByAccountId(
      parseInt(rawL2Tx.from_id, 16)
    );
    const receiver_script_hash = await this.getScriptHashByAccountId(
      parseInt(rawL2Tx.to_id, 16)
    );
    const message = this.generateTransactionMessageToSign(
      rawL2Tx,
      sender_script_hash,
      receiver_script_hash,
      msg_type === SigningMessageType.withPrefix // with personal sign prefix in message, default is true.
    );
    return message;
  }

  async generateMessageFromEthTransaction(
    tx: EthTransaction,
    msg_type: SigningMessageType = SigningMessageType.withPrefix
  ): Promise<string> {
    const { from, to } = tx;

    const to_id = await this.allTypeEthAddressToAccountId(to);
    const sender_script_hash = this.computeScriptHashByEoaEthAddress(from);
    const receiver_script_hash = await this.getScriptHashByAccountId(
      parseInt(to_id)
    );

    const polyjuice_tx = await this.assembleRawL2Transaction(tx);
    const message = this.generateTransactionMessageToSign(
      polyjuice_tx,
      sender_script_hash,
      receiver_script_hash,
      msg_type === SigningMessageType.withPrefix // with personal sign prefix in message, default is true.
    );
    return message;
  }

  serializeL2Transaction(tx: L2Transaction): HexString {
    const _tx = NormalizeL2Transaction(tx);
    return new Reader(SerializeL2Transaction(_tx)).serializeJson();
  }

  serializeRawL2Transaction(tx: RawL2Transaction): HexString {
    const _tx = NormalizeRawL2Transaction(tx);
    return new Reader(SerializeRawL2Transaction(_tx)).serializeJson();
  }

  serializeL2TransactionWithAddressMapping(
    tx: L2TransactionWithAddressMapping
  ): HexString {
    const _tx = NormalizeL2TransactionWithAddressMapping(tx);
    return new Reader(
      SerializeL2TransactionWithAddressMapping(_tx)
    ).serializeJson();
  }

  serializeRawL2TransactionWithAddressMapping(
    tx: RawL2TransactionWithAddressMapping
  ): HexString {
    const _tx = NormalizeRawL2TransactionWithAddressMapping(tx);
    return new Reader(
      SerializeRawL2TransactionWithAddressMapping(_tx)
    ).serializeJson();
  }

  async gw_executeL2Transaction(
    raw_tx: RawL2Transaction,
    signature: HexString
  ): Promise<RunResult> {
    const l2_tx = { raw: raw_tx, signature: signature };
    const serialize_tx = this.serializeL2Transaction(l2_tx);
    const errorWhenNoResult = `failed to get gw_execute_l2transaction runResult.`;
    return this.jsonRPC(
      "gw_execute_l2transaction",
      [serialize_tx],
      errorWhenNoResult
    );
  }

  async gw_executeRawL2Transaction(
    raw_tx: RawL2Transaction
  ): Promise<RunResult> {
    const serialize_tx = this.serializeRawL2Transaction(raw_tx);
    const errorWhenNoResult = `failed to get gw_executeRawL2Transaction runResult`;
    return this.jsonRPC(
      "gw_execute_raw_l2transaction",
      [serialize_tx],
      errorWhenNoResult
    );
  }

  // poly_executeRawL2Transaction diff from gw_executeRawL2Transaction for it carry extra addressMapping data
  async poly_executeRawL2Transaction(
    raw_tx: RawL2TransactionWithAddressMapping
  ): Promise<RunResult> {
    const serialize_tx =
      this.serializeRawL2TransactionWithAddressMapping(raw_tx);
    const errorWhenNoResult = `failed to get poly_execute_raw_l2transaction runResult`;
    return this.jsonRPC(
      "poly_executeRawL2Transaction",
      [serialize_tx],
      errorWhenNoResult
    );
  }

  async gw_submitL2Transaction(
    raw_tx: RawL2Transaction,
    signature: HexString
  ): Promise<Hash> {
    const l2_tx = { raw: raw_tx, signature: signature };
    const serialize_tx = this.serializeL2Transaction(l2_tx);
    const errorWhenNoResult = `failed to get gw_submit_l2transaction txHash, l2_tx: ${JSON.stringify(
      l2_tx,
      null,
      2
    )}`;
    return this.jsonRPC(
      "gw_submit_l2transaction",
      [serialize_tx],
      errorWhenNoResult
    );
  }

  async gw_submitSerializedL2Transaction(
    serialize_tx: HexString
  ): Promise<Hash> {
    const errorWhenNoResult = `failed to get gw_submit_l2transaction txHash, serialize_tx: serialize_tx`;
    return this.jsonRPC(
      "gw_submit_l2transaction",
      [serialize_tx],
      errorWhenNoResult
    );
  }

  // poly_submitL2Transaction diff from gw_submitL2Transaction for it carry extra addressMapping data
  async poly_submitL2Transaction(
    l2_tx: L2TransactionWithAddressMapping
  ): Promise<Hash> {
    const serialize_tx = this.serializeL2TransactionWithAddressMapping(l2_tx);
    const errorWhenNoResult = `failed to get poly_submitL2Transaction txHash, l2_tx: ${JSON.stringify(
      l2_tx,
      null,
      2
    )}`;
    return this.jsonRPC(
      "poly_submitL2Transaction",
      [serialize_tx],
      errorWhenNoResult
    );
  }

  async poly_submitSerializedL2Transaction(
    serialize_tx: HexString
  ): Promise<Hash> {
    const errorWhenNoResult = `failed to get gw_submit_l2transaction txHash, serialize_tx: serialize_tx`;
    return this.jsonRPC(
      "poly_submitL2Transaction",
      [serialize_tx],
      errorWhenNoResult
    );
  }

  async gw_getTransactionReceipt(
    tx_hash: Hash
  ): Promise<GwTransactionReceipt | null> {
    return this.jsonRPC(
      "gw_get_transaction_receipt",
      [tx_hash],
      null,
      RequireResult.canBeEmpty
    );
  }

  async getRollupTypeHash(): Promise<HexString> {
    const errorWhenNoResult = `unable to fetch rollupTypeHash from web3 server.`;
    return this.jsonRPC("poly_getRollupTypeHash", [], errorWhenNoResult);
  }

  async getEthAccountLockHash(): Promise<HexString> {
    const errorWhenNoResult = `unable to fetch ethAccountLockHash from web3 server.`;
    return this.jsonRPC("poly_getEthAccountLockHash", [], errorWhenNoResult);
  }

  async getContractValidatorHash(): Promise<HexString> {
    const errorWhenNoResult = `unable to fetch ContractValidatorHash from web3 server.`;
    return this.jsonRPC(
      "poly_getContractValidatorTypeHash",
      [],
      errorWhenNoResult
    );
  }

  async getPolyjuiceCreatorAccountId(): Promise<HexNumber> {
    const errorWhenNoResult = `unable to fetch creatorId from web3 server.`;
    return this.jsonRPC("poly_getCreatorId", [], errorWhenNoResult);
  }

  async getPolyjuiceDefaultFromAddress(): Promise<HexString> {
    const errorWhenNoResult = `unable to fetch defaultFromAddress from web3 server.`;
    return this.jsonRPC("poly_getDefaultFromAddress", [], errorWhenNoResult);
  }

  async eth_getTransactionReceipt(
    tx_hash: Hash
  ): Promise<EthTransactionReceipt | null> {
    return this.jsonRPC(
      "eth_getTransactionReceipt",
      [tx_hash],
      null,
      RequireResult.canBeEmpty
    );
  }

  async gw_getTransaction(tx_hash: Hash, verbose?: GetTxVerbose) {
    const args = verbose != null ? [tx_hash, verbose] : [tx_hash];
    return this.jsonRPC(
      "gw_get_transaction",
      args,
      null,
      RequireResult.canBeEmpty
    );
  }

  async waitForTransactionReceipt(
    tx_hash: Hash,
    timeout_ms: number = WAIT_TIMEOUT_MILSECS,
    loopInterval_ms = WAIT_LOOP_INTERVAL_MILSECS,
    showLog = false
  ) {
    for (let index = 0; index < timeout_ms; index += loopInterval_ms) {
      const tx_with_status: L2TransactionWithStatus | null =
        await this.gw_getTransaction(tx_hash);
      if (tx_with_status !== null) {
        return;
      }

      await this.asyncSleep(loopInterval_ms);
      if (showLog === true) {
        console.log(
          `keep fetching tx_receipt with ${tx_hash}, waited for ${index} mil seconds`
        );
      }
    }
    throw new Error(
      `tx might be failed: cannot fetch tx_receipt with tx ${tx_hash} in ${timeout_ms} mil seconds`
    );
  }

  asyncSleep(ms = 0) {
    return new Promise((r) => setTimeout(r, ms));
  }

  async allTypeEthAddressToScriptHash(_address: HexString): Promise<HexNumber> {
    // todo: support create2 address in such case that it haven't create real contract yet.
    const address = Buffer.from(_address.slice(2), "hex");

    if (address.byteLength !== 20)
      throw new Error(`Invalid eth address length: ${address.byteLength}`);
    if (address.equals(Buffer.from(Array(20).fill(0)))) {
      // special-case: meta-contract address should return creator id
      const to_id =
        this.creator_id || (await this.getPolyjuiceCreatorAccountId());
      return await this.getScriptHashByAccountId(parseInt(to_id, 16));
    }

    // assume it is normal contract address, thus an godwoken-short-address
    let script_hash: HexString | undefined;
    const setScriptHash = (value: HexString) => {
      script_hash = value;
    };
    const is_contract_address = await this.isShortAddressOnChain(
      _address,
      setScriptHash
    );
    if (is_contract_address) {
      return script_hash!;
    }

    // otherwise, assume it is EOA address
    return this.computeScriptHashByEoaEthAddress(_address);
  }

  async allTypeEthAddressToAccountId(_address: HexString): Promise<HexNumber> {
    // todo: support create2 address in such case that it haven't create real contract yet.
    const address = Buffer.from(_address.slice(2), "hex");

    if (address.byteLength !== 20)
      throw new Error(`Invalid eth address length: ${address.byteLength}`);
    if (address.equals(Buffer.from(Array(20).fill(0))))
      // special-case: meta-contract address should return creator id
      return this.creator_id || (await this.getPolyjuiceCreatorAccountId());

    // assume it is normal contract address, thus an godwoken-short-address
    let script_hash: HexString | undefined;
    const setScriptHash = (value: HexString) => {
      script_hash = value;
    };
    const is_contract_address = await this.isShortAddressOnChain(
      _address,
      setScriptHash
    );
    if (is_contract_address) {
      // below the getScriptHashByShortAddress request is no need
      // since we have pass callback fn to get ScriptHash value
      //script_hash = await this.getScriptHashByShortAddress(_address);
      return await this.getAccountIdByScriptHash(script_hash!);
    }

    // otherwise, assume it is EOA address
    script_hash = this.computeScriptHashByEoaEthAddress(_address);
    const accountId = await this.getAccountIdByScriptHash(script_hash);
    return accountId;
  }
}

// todo: move to another file
export function UInt32ToLeBytes(num: number): HexString {
  const buf = Buffer.allocUnsafe(4);
  buf.writeUInt32LE(+num, 0);
  return "0x" + buf.toString("hex");
}

export function UInt64ToLeBytes(num: bigint): HexString {
  num = BigInt(num);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(num);
  return `0x${buf.toString("hex")}`;
}

export function UInt128ToLeBytes(u128: bigint): HexString {
  if (u128 < U128_MIN) {
    throw new Error(`u128 ${u128} too small`);
  }
  if (u128 > U128_MAX) {
    throw new Error(`u128 ${u128} too large`);
  }
  const buf = Buffer.alloc(16);
  buf.writeBigUInt64LE(u128 & BigInt("0xFFFFFFFFFFFFFFFF"), 0);
  buf.writeBigUInt64LE(u128 >> BigInt(64), 8);
  return "0x" + buf.toString("hex");
}

export function LeBytesToUInt32(hex: HexString): number {
  const buf = Buffer.from(hex.slice(2), "hex");
  return buf.readUInt32LE();
}

export function LeBytesToUInt64(hex: HexString): bigint {
  const buf = Buffer.from(hex.slice(2), "hex");
  return buf.readBigUInt64LE();
}

export function LeBytesToUInt128(hex: HexString): bigint {
  const buf = Buffer.from(hex.slice(2), "hex");
  return buf.slice(8, 16).readBigUInt64LE();
}
