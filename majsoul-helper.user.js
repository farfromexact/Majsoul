// ==UserScript==
// @name         Majsoul Helper MVP
// @namespace    https://local.majsoul-helper/
// @version      0.2.8
// @description  Visible-state/debug helper for Mahjong Soul. No auto discard, no click automation, no message mutation.
// @match        *://*.mahjongsoul.com/*
// @match        *://mahjongsoul.game.yo-star.com/*
// @match        *://*.maj-soul.com/*
// @match        *://game.maj-soul.com/*
// @run-at       document-start
// @inject-into  page
// @grant        none
// ==/UserScript==

var MajsoulHelperBundle = (() => {
  // src/adapter/messageParser.js
  var BINARY_ENVELOPE_SAMPLE_BYTES = 512;
  function readPath(value, path) {
    let current = value;
    for (const part of path) {
      if (current == null || typeof current !== "object" || !(part in current)) return void 0;
      current = current[part];
    }
    return current;
  }
  function firstDefined(...values) {
    return values.find((value) => value !== void 0 && value !== null);
  }
  function definedObject(values) {
    return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== void 0));
  }
  function toArray(value, fallback = []) {
    if (value === void 0 || value === null) return fallback;
    return Array.isArray(value) ? value : [value];
  }
  function readableDoraIndicators(payload = {}) {
    return toArray(firstDefined(payload.doraIndicators, payload.doras, payload.dora, payload.baopai), []);
  }
  function readableDoraTile(payload = {}) {
    const dora = firstDefined(payload.dora, payload.baopai);
    return firstDefined(
      payload.tile,
      payload.pai,
      payload.card,
      payload.doraIndicator,
      Array.isArray(dora) ? void 0 : dora
    );
  }
  function readableScores(payload = {}) {
    const scores = firstDefined(payload.scores, payload.points, payload.finalScores, payload.score);
    if (scores === void 0) return void 0;
    return toArray(scores).map((score) => {
      const number = Number(score);
      return Number.isFinite(number) ? number : score;
    });
  }
  function readableRoundEndReason(payload = {}, sourceName = "") {
    const explicit = firstDefined(payload.reason, payload.roundEndReason, payload.endReason);
    if (explicit !== void 0) return explicit;
    const source = `${sourceName} ${payload.name ?? ""} ${payload.actionName ?? ""}`.toLowerCase();
    if (source.includes("notile") || source.includes("no_tile") || source.includes("ryuukyoku") || source.includes("huangpai")) return "no_tile";
    if (source.includes("liuju")) return "liuju";
    if (source.includes("hule")) return "hule";
    return typeof payload.type === "string" ? payload.type : "ended";
  }
  function toEventType(name = "") {
    const normalized = String(name).toLowerCase();
    if (["round_start", "start_round", "actionnewround", "recordnewround", "newround"].some((key) => normalized.includes(key))) {
      return "round_start";
    }
    if (["deal_hand", "dealhand", "init_hand", "inithand"].some((key) => normalized.includes(key))) {
      return "deal_hand";
    }
    if (["draw_tile", "drawtile", "actiondealtile", "recorddealtile", "actiondealtiles", "dealtile", "deal_tile", "zimo"].some((key) => normalized.includes(key))) {
      return "draw_tile";
    }
    if (["discard_tile", "discardtile", "actiondiscardtile", "recorddiscardtile", "discard", "dapai"].some((key) => normalized.includes(key))) {
      return "discard_tile";
    }
    if (["call_meld", "callmeld", "actionchi_peng_gang", "recordchipenggang", "actionangangaddgang", "recordangangaddgang", "actionbabei", "recordbabei", "chipenggang", "angang", "addgang", "babei", "meld"].some((key) => normalized.includes(key))) {
      return "call_meld";
    }
    if (["riichi", "lizhi", "liqi", "reach"].some((key) => normalized.includes(key))) {
      return "riichi";
    }
    if (["dora", "baopai"].some((key) => normalized.includes(key))) {
      return "dora";
    }
    if (["round_end", "endround", "actionhule", "recordhule", "actionliuju", "recordliuju", "actionnotile", "recordnotile", "liuju", "notile", "ryuukyoku", "huangpai", "hule"].some((key) => normalized.includes(key))) {
      return "round_end";
    }
    return null;
  }
  function extractEnvelope(message) {
    if (!message || typeof message !== "object") return null;
    const name = firstDefined(
      message.name,
      message.method,
      message.type,
      message.event,
      message.msg,
      message.command,
      readPath(message, ["data", "name"]),
      readPath(message, ["data", "type"])
    );
    const payload = firstDefined(message.payload, message.data, message.result, message.params, message);
    return { name, payload };
  }
  function extractDecodedName(value, depth = 0) {
    if (depth > 3 || value === void 0 || value === null) return void 0;
    if (typeof value === "string") return value;
    if (typeof value !== "object") return void 0;
    const direct = firstDefined(value.name, value.method, value.type, value.event, value.msg, value.command, value.actionName, value.action);
    if (typeof direct === "string") return direct;
    const typed = firstDefined(
      readPath(value, ["$type", "fullName"]),
      readPath(value, ["$type", "name"]),
      readPath(value, ["constructor", "$type", "fullName"]),
      readPath(value, ["constructor", "$type", "name"])
    );
    if (typeof typed === "string") return typed;
    const nested = firstDefined(
      readPath(value, ["wrapper", "name"]),
      readPath(value, ["head", "name"]),
      readPath(value, ["message", "name"]),
      readPath(value, ["name", "name"]),
      readPath(value, ["method", "name"]),
      readPath(value, ["type", "name"])
    );
    const nestedName = extractDecodedName(nested, depth + 1);
    if (nestedName) return nestedName;
    const constructorName = value.constructor?.name;
    return /^(Action|Record)[A-Za-z0-9_]+$/.test(constructorName) ? constructorName : void 0;
  }
  function decodedPayloadOf(message) {
    if (!message || typeof message !== "object") return {};
    return firstDefined(message.data, message.payload, message.result, message.params, message.detail, message);
  }
  function decodedStepOf(message, payload) {
    return firstDefined(
      message?.step,
      message?.seq,
      message?.sequence,
      payload?.step,
      payload?.seq,
      payload?.sequence
    );
  }
  function isActionPrototypeName(name = "") {
    return String(name).split(".").pop() === "ActionPrototype";
  }
  function buildDecodedEnvelope(message) {
    if (!message || typeof message !== "object") return null;
    const outerName = extractDecodedName(message);
    const outerPayload = decodedPayloadOf(message);
    const actionName = extractDecodedName(outerPayload);
    const hasNestedActionPayload = Boolean(
      actionName && outerPayload && typeof outerPayload === "object" && outerPayload !== message && ("data" in outerPayload || "payload" in outerPayload || "result" in outerPayload)
    );
    const name = isActionPrototypeName(outerName) || hasNestedActionPayload ? actionName : outerName;
    if (!name) return null;
    const payload = hasNestedActionPayload || isActionPrototypeName(outerName) ? decodedPayloadOf(outerPayload) : outerPayload;
    const methodName = isActionPrototypeName(outerName) ? ".lq.ActionPrototype" : outerName;
    return {
      name,
      payload: payload && typeof payload === "object" ? payload : {},
      methodName,
      actionName: /^(Action|Record)[A-Za-z0-9_]+$/.test(String(name)) ? String(name) : void 0,
      step: decodedStepOf(message, outerPayload)
    };
  }
  function decodedBinaryEnvelope(envelope) {
    return definedObject({
      methodName: envelope.methodName,
      actionName: envelope.actionName,
      step: envelope.step,
      decodedSource: "client"
    });
  }
  function normalizePayload(type, payload, sourceName = "") {
    if (!payload || typeof payload !== "object") return {};
    if (type === "round_start") {
      const chang = firstDefined(payload.chang, payload.round_index, payload.roundIndex);
      const ju = firstDefined(payload.ju, payload.ju_index, payload.juIndex, payload.dealer);
      const round = firstDefined(
        payload.round,
        payload.round_name,
        chang !== void 0 && ju !== void 0 ? `${chang}-${ju}` : void 0,
        chang,
        ju
      );
      return {
        round,
        chang,
        ju,
        honba: firstDefined(payload.honba, payload.ben, payload.ben_chang, 0),
        riichiSticks: firstDefined(payload.riichiSticks, payload.lizhibang, payload.liqibang, payload.sticks, 0),
        roundWind: firstDefined(payload.roundWind, payload.changfeng, payload.round_wind),
        seatWind: firstDefined(payload.seatWind, payload.zifeng, payload.seat_wind),
        scores: firstDefined(payload.scores, payload.points, payload.score),
        tiles: firstDefined(payload.tiles, payload.hand, payload.handTiles, payload.qipai, payload.tehai, []),
        doraIndicators: readableDoraIndicators(payload),
        leftTileCount: firstDefined(payload.leftTileCount, payload.left_tile_count, payload.wallCount)
      };
    }
    if (type === "deal_hand") {
      return {
        tiles: firstDefined(payload.tiles, payload.hand, payload.handTiles, payload.qipai, payload.tehai, [])
      };
    }
    if (type === "draw_tile") {
      const riichi = normalizeReadableRiichi(firstDefined(payload.riichi, payload.liqi));
      return {
        seat: firstDefined(payload.seat, payload.seat_id, payload.who, payload.actor),
        tile: firstDefined(payload.tile, payload.pai, payload.card),
        leftTileCount: firstDefined(payload.leftTileCount, payload.left_tile_count, payload.wallCount),
        doraIndicators: readableDoraIndicators(payload),
        ...riichi ? { riichi } : {}
      };
    }
    if (type === "discard_tile") {
      return {
        seat: firstDefined(payload.seat, payload.seat_id, payload.who, payload.actor),
        tile: firstDefined(payload.tile, payload.pai, payload.card),
        tsumogiri: firstDefined(payload.tsumogiri, payload.is_tsumogiri, payload.moqie),
        isRiichi: firstDefined(payload.isRiichi, payload.is_liqi, payload.riichi, payload.lizhi, payload.liqi),
        doraIndicators: readableDoraIndicators(payload)
      };
    }
    if (type === "call_meld") {
      const riichi = normalizeReadableRiichi(firstDefined(payload.riichi, payload.liqi));
      return {
        seat: firstDefined(payload.seat, payload.seat_id, payload.who, payload.actor),
        meld: firstDefined(payload.meld, payload.tiles, payload.pais, payload.fulu),
        type: firstDefined(payload.type, payload.meldType),
        doraIndicators: readableDoraIndicators(payload),
        ...riichi ? { riichi } : {}
      };
    }
    if (type === "riichi") {
      return {
        seat: firstDefined(payload.seat, payload.seat_id, payload.who, payload.actor),
        riichiSticks: firstDefined(payload.riichiSticks, payload.lizhibang, payload.liqibang),
        score: firstDefined(payload.score, payload.points)
      };
    }
    if (type === "dora") {
      return {
        tile: readableDoraTile(payload),
        doraIndicators: readableDoraIndicators(payload)
      };
    }
    if (type === "round_end") {
      return {
        reason: readableRoundEndReason(payload, sourceName),
        type: payload.type,
        seat: firstDefined(payload.seat, payload.seat_id, payload.who, payload.actor),
        scores: readableScores(payload),
        doraIndicators: readableDoraIndicators(payload),
        tiles: firstDefined(payload.tiles, payload.hand, payload.handTiles, payload.pais, payload.tehai, []),
        liujumanguan: firstDefined(payload.liujumanguan, payload.liujuManguan),
        gameEnd: firstDefined(payload.gameEnd, payload.game_end)
      };
    }
    return payload;
  }
  function normalizeReadableRiichi(value) {
    if (!value || typeof value !== "object") return void 0;
    const riichi = definedObject({
      seat: firstDefined(value.seat, value.seat_id, value.who, value.actor),
      score: firstDefined(value.score, value.points),
      riichiSticks: firstDefined(value.riichiSticks, value.lizhibang, value.liqibang)
    });
    return Object.keys(riichi).length ? riichi : void 0;
  }
  function tryParseJsonText(text) {
    const trimmed = text.trim();
    if (!trimmed || !["{", "["].includes(trimmed[0])) return null;
    try {
      return JSON.parse(trimmed);
    } catch {
      return null;
    }
  }
  function toUint8Array(data) {
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    return null;
  }
  function bytesToHex(bytes, max = bytes.length) {
    return Array.from(bytes.slice(0, max), (byte) => byte.toString(16).padStart(2, "0")).join(" ");
  }
  function isPrintableShortText(text) {
    return typeof text === "string" && /^[\x20-\x7E]{1,80}$/.test(text);
  }
  function groupValuesByField(entries, mapValue) {
    const grouped = /* @__PURE__ */ new Map();
    for (const entry of entries) {
      const value = mapValue(entry);
      if (value === void 0 || value === null || value === "") continue;
      if (!grouped.has(entry.field)) grouped.set(entry.field, []);
      const values = grouped.get(entry.field);
      if (values.length < 12) values.push(value);
    }
    return Array.from(grouped.entries()).sort((a, b) => a[0] - b[0]).map(([field, values]) => ({ field, values }));
  }
  function summarizePayloadFields(bytes) {
    if (!bytes?.length) {
      return {
        varints: [],
        strings: [],
        tileStrings: []
      };
    }
    const fields = parseProtobufEnvelope(bytes).fields;
    return {
      varints: groupValuesByField(fields.varints, (entry) => entry.value),
      strings: groupValuesByField(fields.lengthDelimited, (entry) => isPrintableShortText(entry.text) ? entry.text : void 0),
      tileStrings: groupValuesByField(fields.lengthDelimited, (entry) => tileLike(entry.text) ? entry.text : void 0)
    };
  }
  function decodeVarint(bytes, offset) {
    let value = 0;
    let multiplier = 1;
    let cursor = offset;
    while (cursor < bytes.length && cursor - offset < 10) {
      const byte = bytes[cursor];
      value += (byte & 127) * multiplier;
      if (!Number.isSafeInteger(value)) return null;
      cursor += 1;
      if ((byte & 128) === 0) return { value, offset: cursor };
      multiplier *= 128;
    }
    return null;
  }
  function decodeUtf8(bytes) {
    try {
      return new TextDecoder().decode(bytes);
    } catch {
      return "";
    }
  }
  function parseProtobufEnvelope(bytes) {
    let offset = 0;
    const lengthDelimited = [];
    const varints = [];
    while (offset < bytes.length) {
      const tag = decodeVarint(bytes, offset);
      if (!tag) break;
      offset = tag.offset;
      const field = tag.value >> 3;
      const wireType = tag.value & 7;
      if (wireType === 0) {
        const value = decodeVarint(bytes, offset);
        if (!value) break;
        varints.push({ field, value: value.value });
        offset = value.offset;
        continue;
      }
      if (wireType === 2) {
        const length = decodeVarint(bytes, offset);
        if (!length) break;
        offset = length.offset;
        if (!Number.isSafeInteger(length.value) || length.value < 0) break;
        const end = offset + length.value;
        if (!Number.isSafeInteger(end) || end < offset) break;
        if (end > bytes.length) break;
        const valueBytes = bytes.slice(offset, end);
        lengthDelimited.push({ field, bytes: valueBytes, text: decodeUtf8(valueBytes) });
        offset = end;
        continue;
      }
      if (wireType === 5) {
        if (offset + 4 > bytes.length) break;
        offset += 4;
        continue;
      }
      if (wireType === 1) {
        if (offset + 8 > bytes.length) break;
        offset += 8;
        continue;
      }
      break;
    }
    const methodEntry = lengthDelimited.find((entry) => /^\.?lq\./.test(entry.text)) || lengthDelimited.find((entry) => /Action|Req|Res|Notify|Lobby/.test(entry.text));
    const dataEntry = lengthDelimited.find((entry) => entry !== methodEntry && entry.bytes.length > 0);
    return {
      methodName: methodEntry?.text,
      payloadBytes: dataEntry?.bytes || new Uint8Array(),
      fields: { varints, lengthDelimited }
    };
  }
  function parseActionPrototype(payloadBytes) {
    if (!payloadBytes?.length) return null;
    const decoded = parseProtobufEnvelope(payloadBytes);
    const actionEntry = decoded.fields.lengthDelimited.find((entry) => /^(Action|Record)[A-Za-z0-9_]+$/.test(entry.text));
    if (!actionEntry) return null;
    const dataEntry = decoded.fields.lengthDelimited.find((entry) => entry !== actionEntry && entry.bytes.length > 0);
    return {
      step: decoded.fields.varints[0]?.value,
      actionName: actionEntry.text,
      actionPayloadBytes: dataEntry?.bytes || new Uint8Array(),
      actionPayloadSample: bytesToHex(dataEntry?.bytes || new Uint8Array(), BINARY_ENVELOPE_SAMPLE_BYTES),
      actionPayloadTruncated: (dataEntry?.bytes.length || 0) > BINARY_ENVELOPE_SAMPLE_BYTES,
      actionPayloadFields: summarizePayloadFields(dataEntry?.bytes || new Uint8Array())
    };
  }
  function actionNameFromMethod(methodName) {
    const lastSegment = String(methodName || "").split(".").pop();
    return /^(Action|Record)[A-Za-z0-9_]+$/.test(lastSegment) ? lastSegment : null;
  }
  function tileLike(text) {
    return /^[0-9][mps]$|^[1-7]z$/.test(text);
  }
  function varintFields(fields, id) {
    return fields.varints.filter((entry) => entry.field === id).map((entry) => entry.value);
  }
  function decodeVarintSequence(bytes = new Uint8Array()) {
    const values = [];
    let offset = 0;
    while (offset < bytes.length) {
      const decoded = decodeVarint(bytes, offset);
      if (!decoded || decoded.offset <= offset) break;
      values.push(decoded.value);
      offset = decoded.offset;
    }
    return offset === bytes.length ? values : [];
  }
  function packedVarintFields(fields, id) {
    return fields.lengthDelimited.filter((entry) => entry.field === id).flatMap((entry) => decodeVarintSequence(entry.bytes));
  }
  function numericField(fields, id) {
    return numericFields(fields, id)[0];
  }
  function numericFields(fields, id) {
    return [
      ...varintFields(fields, id),
      ...packedVarintFields(fields, id)
    ];
  }
  function stringField(fields, id) {
    return fields.lengthDelimited.find((entry) => entry.field === id && entry.text)?.text;
  }
  function stringFields(fields, id) {
    return fields.lengthDelimited.filter((entry) => entry.field === id && entry.text).map((entry) => entry.text);
  }
  function tileStringFields(fields, id) {
    return stringFields(fields, id).filter(tileLike);
  }
  function decodeUnityEncodedDiscardPayload(bytes) {
    if (!bytes || bytes.length !== 14) return null;
    const seat = bytes[1] ^ 126;
    const tile = String.fromCharCode(bytes[4] ^ 102, bytes[5] ^ 212);
    const tsumogiri = bytes[9] ^ 202;
    if (!Number.isInteger(seat) || seat < 0 || seat > 3) return null;
    if (!tileLike(tile)) return null;
    if (![0, 1].includes(tsumogiri)) return null;
    return {
      seat,
      tile,
      tsumogiri: Boolean(tsumogiri),
      isRiichi: false,
      doraIndicators: [],
      payloadCodec: "unity-xor-discard-short"
    };
  }
  function nestedPayloadFields(fields, id) {
    return fields.lengthDelimited.filter((entry) => entry.field === id && entry.bytes?.length).map((entry) => parseProtobufEnvelope(entry.bytes).fields);
  }
  function nestedPayloadEntries(fields, id) {
    return fields.lengthDelimited.filter((entry) => entry.field === id && entry.bytes?.length);
  }
  function decodeLiQiSuccess(fields, id = 5) {
    const liqiFields = nestedPayloadFields(fields, id)[0];
    if (!liqiFields) return void 0;
    const riichi = definedObject({
      seat: numericField(liqiFields, 1),
      score: numericField(liqiFields, 2),
      riichiSticks: numericField(liqiFields, 3)
    });
    return Object.keys(riichi).length ? riichi : void 0;
  }
  function decodeGameEndScores(fields, id) {
    const gameEnd = nestedPayloadFields(fields, id)[0];
    return gameEnd ? numericFields(gameEnd, 1) : [];
  }
  function denseScoreArray(scores) {
    if (!scores.length) return false;
    for (let index = 0; index < scores.length; index += 1) {
      if (scores[index] === void 0) return false;
    }
    return true;
  }
  function decodeNoTileScoreInfos(fields) {
    const scoreInfos = nestedPayloadFields(fields, 3);
    const orderedScores = [];
    const scoresBySeat = [];
    for (const scoreFields of scoreInfos) {
      const score = numericField(scoreFields, 7);
      if (score !== void 0) orderedScores.push(score);
      const seat = numericField(scoreFields, 1);
      if (seat !== void 0 && score !== void 0) {
        scoresBySeat[seat] = score;
      }
    }
    const doraIndicators = scoreInfos.map((scoreFields) => tileStringFields(scoreFields, 6)).find((tiles) => tiles.length) || [];
    return {
      scores: denseScoreArray(scoresBySeat) ? scoresBySeat : orderedScores,
      doraIndicators
    };
  }
  function methodLastSegment(methodName) {
    return String(methodName || "").split(".").pop();
  }
  function isGameRestoreMethod(methodName) {
    return methodLastSegment(methodName) === "GameRestore";
  }
  function isGameRestoreCarrierMethod(methodName) {
    return ["ResSyncGame", "ResEnterGame"].includes(methodLastSegment(methodName));
  }
  function decodeSnapshotFulu(fields) {
    return tileStringFields(fields, 2);
  }
  function decodeGameSnapshotPayload(bytes) {
    if (!bytes?.length) return {};
    const fields = parseProtobufEnvelope(bytes).fields;
    const chang = numericField(fields, 1);
    const ju = numericField(fields, 2);
    const doraIndicators = tileStringFields(fields, 7);
    const players = nestedPayloadFields(fields, 9);
    const scores = [];
    const discards = [[], [], [], []];
    const melds = [[], [], [], []];
    const riichi = [false, false, false, false];
    players.forEach((playerFields, seat) => {
      if (seat > 3) return;
      const score = numericField(playerFields, 1);
      if (score !== void 0) scores[seat] = score;
      const riichiPosition = numericField(playerFields, 2);
      if (riichiPosition !== void 0 && riichiPosition > 0) riichi[seat] = true;
      discards[seat] = tileStringFields(playerFields, 4);
      melds[seat] = nestedPayloadFields(playerFields, 5).map(decodeSnapshotFulu).filter((tiles) => tiles.length);
    });
    return {
      round: chang !== void 0 && ju !== void 0 ? `${chang}-${ju}` : void 0,
      chang,
      ju,
      honba: numericField(fields, 3),
      currentTurn: numericField(fields, 4),
      leftTileCount: numericField(fields, 5),
      tiles: tileStringFields(fields, 6),
      doraIndicators,
      riichiSticks: numericField(fields, 8),
      scores: scores.some((score) => score !== void 0) ? scores.map((score) => score ?? 25e3) : void 0,
      discards,
      melds,
      riichi
    };
  }
  function actionPayloadEnvelope(baseEnvelope, actionPrototype, actionPayloadBytes) {
    return {
      frameType: baseEnvelope.frameType,
      frameTypeName: baseEnvelope.frameTypeName,
      requestId: baseEnvelope.requestId,
      methodName: baseEnvelope.methodName,
      actionName: actionPrototype.actionName,
      step: actionPrototype.step,
      payloadLength: baseEnvelope.payloadLength,
      payloadSample: baseEnvelope.payloadSample,
      payloadTruncated: baseEnvelope.payloadTruncated,
      gameRestoreSourceMethod: baseEnvelope.gameRestoreSourceMethod,
      syncGameStep: baseEnvelope.syncGameStep,
      syncGameEnded: baseEnvelope.syncGameEnded,
      enterGameEnded: baseEnvelope.enterGameEnded,
      gameRestorePayloadLength: baseEnvelope.gameRestorePayloadLength,
      gameRestorePayloadTruncated: baseEnvelope.gameRestorePayloadTruncated,
      actionPayloadLength: actionPayloadBytes.length,
      actionPayloadSample: bytesToHex(actionPayloadBytes, BINARY_ENVELOPE_SAMPLE_BYTES),
      actionPayloadTruncated: actionPayloadBytes.length > BINARY_ENVELOPE_SAMPLE_BYTES,
      actionPayloadFields: summarizePayloadFields(actionPayloadBytes)
    };
  }
  function parseRestoredActionEvents(baseEnvelope, restoreFields) {
    const events = [];
    for (const entry of nestedPayloadEntries(restoreFields, 2)) {
      const actionPrototype = parseActionPrototype(entry.bytes);
      if (!actionPrototype?.actionName) continue;
      const type = toEventType(actionPrototype.actionName);
      if (!type) continue;
      const actionPayload = decodeSimpleActionPayload(actionPrototype.actionName, actionPrototype.actionPayloadBytes);
      const payload = {
        ...actionPayload,
        binaryEnvelope: actionPayloadEnvelope(baseEnvelope, actionPrototype, actionPrototype.actionPayloadBytes)
      };
      events.push(...expandStandardEvents(type, payload));
    }
    return events;
  }
  function parseGameRestoreMessage(baseEnvelope, payloadBytes) {
    const fields = parseProtobufEnvelope(payloadBytes).fields;
    const events = [];
    const snapshotEntry = nestedPayloadEntries(fields, 1)[0];
    if (snapshotEntry) {
      events.push({
        type: "round_start",
        payload: {
          ...decodeGameSnapshotPayload(snapshotEntry.bytes),
          binaryEnvelope: {
            ...baseEnvelope,
            snapshotPayloadLength: snapshotEntry.bytes.length,
            snapshotPayloadSample: bytesToHex(snapshotEntry.bytes, BINARY_ENVELOPE_SAMPLE_BYTES),
            snapshotPayloadTruncated: snapshotEntry.bytes.length > BINARY_ENVELOPE_SAMPLE_BYTES
          }
        }
      });
    }
    events.push(...parseRestoredActionEvents(baseEnvelope, fields));
    return events;
  }
  function getGameRestoreCarrierEntry(payloadBytes) {
    if (!payloadBytes?.length) return null;
    const fields = parseProtobufEnvelope(payloadBytes).fields;
    return {
      fields,
      restoreEntry: nestedPayloadEntries(fields, 4)[0] || null
    };
  }
  function parseGameRestoreCarrierMessage(baseEnvelope, payloadBytes) {
    const carrier = getGameRestoreCarrierEntry(payloadBytes);
    if (!carrier?.restoreEntry) return [];
    const sourceMethod = methodLastSegment(baseEnvelope.methodName);
    return parseGameRestoreMessage({
      ...baseEnvelope,
      gameRestoreSourceMethod: sourceMethod,
      syncGameStep: sourceMethod === "ResSyncGame" ? numericField(carrier.fields, 3) : void 0,
      syncGameEnded: sourceMethod === "ResSyncGame" ? Boolean(numericField(carrier.fields, 2)) : void 0,
      enterGameEnded: sourceMethod === "ResEnterGame" ? Boolean(numericField(carrier.fields, 2)) : void 0,
      gameRestorePayloadLength: carrier.restoreEntry.bytes.length,
      gameRestorePayloadSample: bytesToHex(carrier.restoreEntry.bytes, BINARY_ENVELOPE_SAMPLE_BYTES),
      gameRestorePayloadTruncated: carrier.restoreEntry.bytes.length > BINARY_ENVELOPE_SAMPLE_BYTES
    }, carrier.restoreEntry.bytes);
  }
  function extractGameRestoreActionNames(payloadBytes) {
    if (!payloadBytes?.length) return [];
    const fields = parseProtobufEnvelope(payloadBytes).fields;
    return nestedPayloadEntries(fields, 2).map((entry) => parseActionPrototype(entry.bytes)?.actionName).filter(Boolean);
  }
  function extractRestoreActionNames(methodName, payloadBytes) {
    if (isGameRestoreMethod(methodName)) return extractGameRestoreActionNames(payloadBytes);
    if (isGameRestoreCarrierMethod(methodName)) {
      const carrier = getGameRestoreCarrierEntry(payloadBytes);
      return carrier?.restoreEntry ? extractGameRestoreActionNames(carrier.restoreEntry.bytes) : [];
    }
    return void 0;
  }
  function decodeSimpleActionPayload(actionName, bytes) {
    if (!actionName || !bytes?.length) return {};
    const decoded = parseProtobufEnvelope(bytes);
    const fields = decoded.fields;
    const allTiles = fields.lengthDelimited.map((entry) => entry.text).filter(tileLike);
    if (actionName === "ActionDiscardTile" || actionName === "RecordDiscardTile") {
      const decoded2 = {
        seat: numericField(fields, 1),
        tile: stringField(fields, 2),
        tsumogiri: Boolean(numericField(fields, 5)),
        isRiichi: Boolean(firstDefined(numericField(fields, 3), numericField(fields, 9))),
        doraIndicators: tileStringFields(fields, 8)
      };
      if (decoded2.seat !== void 0 || decoded2.tile || decoded2.doraIndicators.length) return decoded2;
      return decodeUnityEncodedDiscardPayload(bytes) || decoded2;
    }
    if (actionName === "ActionDealTile" || actionName === "RecordDealTile") {
      const riichi = decodeLiQiSuccess(fields, 5);
      return {
        seat: numericField(fields, 1),
        tile: stringField(fields, 2),
        leftTileCount: numericField(fields, 3),
        doraIndicators: tileStringFields(fields, 6),
        ...riichi ? { riichi } : {}
      };
    }
    if (actionName === "ActionChiPengGang" || actionName === "RecordChiPengGang") {
      const riichi = decodeLiQiSuccess(fields, 5);
      return {
        seat: numericField(fields, 1),
        type: numericField(fields, 2),
        meld: tileStringFields(fields, 3),
        ...riichi ? { riichi } : {}
      };
    }
    if (actionName === "ActionAnGangAddGang" || actionName === "RecordAnGangAddGang") {
      return {
        seat: numericField(fields, 1),
        type: firstDefined(numericField(fields, 2), stringField(fields, 2)),
        doraIndicators: tileStringFields(fields, 6),
        meld: tileStringFields(fields, 3)
      };
    }
    if (actionName === "ActionBaBei" || actionName === "RecordBaBei") {
      return {
        seat: numericField(fields, 1),
        type: "babei",
        meld: ["4z"],
        tsumogiri: Boolean(actionName === "RecordBaBei" ? numericField(fields, 8) : numericField(fields, 9)),
        doraIndicators: tileStringFields(fields, 6)
      };
    }
    if (actionName === "ActionLiqi" || actionName === "RecordLiqi") {
      return {
        seat: numericField(fields, 1),
        step: numericField(fields, 2)
      };
    }
    if (actionName === "ActionLiqiSuccess" || actionName === "RecordLiqiSuccess") {
      return {
        seat: numericField(fields, 1),
        score: numericField(fields, 2),
        riichiSticks: numericField(fields, 3)
      };
    }
    if (actionName === "ActionHule" || actionName === "RecordHule") {
      const scores = numericFields(fields, 5);
      const gameEndScores = decodeGameEndScores(fields, 6);
      return {
        reason: "hule",
        scores: scores.length ? scores : gameEndScores,
        tiles: allTiles,
        doraIndicators: tileStringFields(fields, 7)
      };
    }
    if (actionName === "ActionLiuJu" || actionName === "RecordLiuJu") {
      const riichi = decodeLiQiSuccess(fields, 5);
      const scores = decodeGameEndScores(fields, 2);
      return {
        reason: "liuju",
        type: numericField(fields, 1),
        seat: numericField(fields, 3),
        tiles: tileStringFields(fields, 4).length ? tileStringFields(fields, 4) : allTiles,
        allPlayerTiles: tileStringFields(fields, 6),
        ...scores.length ? { scores } : {},
        ...riichi ? { riichi } : {}
      };
    }
    if (actionName === "ActionNoTile" || actionName === "RecordNoTile") {
      const scoreInfo = decodeNoTileScoreInfos(fields);
      return {
        reason: "no_tile",
        type: numericField(fields, 1),
        liujumanguan: Boolean(numericField(fields, 1)),
        gameEnd: Boolean(numericField(fields, 4)),
        scores: scoreInfo.scores,
        doraIndicators: scoreInfo.doraIndicators,
        tiles: allTiles
      };
    }
    if (toEventType(actionName) === "dora") {
      return {
        tile: allTiles[0],
        doraIndicators: allTiles
      };
    }
    if (actionName === "ActionNewRound") {
      const chang = numericField(fields, 1);
      const ju = numericField(fields, 2);
      const doraIndicators = [
        stringField(fields, 5),
        ...tileStringFields(fields, 14)
      ].filter(tileLike);
      const handTiles = tileStringFields(fields, 4);
      return {
        round: chang !== void 0 && ju !== void 0 ? `${chang}-${ju}` : void 0,
        chang,
        ju,
        honba: numericField(fields, 3),
        riichiSticks: numericField(fields, 8),
        doraIndicators,
        scores: numericFields(fields, 6),
        tiles: handTiles.length ? handTiles : allTiles.filter((tile) => !doraIndicators.includes(tile)),
        leftTileCount: numericField(fields, 13)
      };
    }
    if (actionName === "RecordNewRound") {
      const chang = numericField(fields, 1);
      const ju = numericField(fields, 2);
      const doraIndicators = [
        stringField(fields, 4),
        ...tileStringFields(fields, 16)
      ].filter(tileLike);
      return {
        round: chang !== void 0 && ju !== void 0 ? `${chang}-${ju}` : void 0,
        chang,
        ju,
        honba: numericField(fields, 3),
        riichiSticks: numericField(fields, 6),
        doraIndicators,
        scores: numericFields(fields, 5),
        tiles: tileStringFields(fields, 7),
        leftTileCount: numericField(fields, 15)
      };
    }
    return {};
  }
  function toRiichiEventPayload(payload = {}) {
    if (!payload.riichi || typeof payload.riichi !== "object") return null;
    const riichi = definedObject({
      seat: payload.riichi.seat,
      score: payload.riichi.score,
      riichiSticks: payload.riichi.riichiSticks,
      sourceAction: payload.binaryEnvelope?.actionName,
      sourceMethodName: payload.binaryEnvelope?.methodName,
      sourceStep: payload.binaryEnvelope?.step
    });
    return Object.keys(riichi).length ? riichi : null;
  }
  function expandStandardEvents(type, payload) {
    const events = [{ type, payload }];
    if (type !== "riichi") {
      const riichiPayload = toRiichiEventPayload(payload);
      if (riichiPayload) events.push({ type: "riichi", payload: riichiPayload });
    }
    return events;
  }
  function parseBinaryFrame(data) {
    const bytes = toUint8Array(data);
    if (!bytes || bytes.length < 2) return null;
    const frameType = bytes[0];
    if (![1, 2, 3].includes(frameType)) return null;
    const frameTypeName = frameType === 1 ? "Notify" : frameType === 2 ? "Request" : "Response";
    const messageOffset = frameType === 1 ? 1 : 3;
    if (bytes.length <= messageOffset) return { frameType, frameTypeName, requestId: null };
    const requestId = frameType === 1 ? null : bytes[1] | bytes[2] << 8;
    const envelope = parseProtobufEnvelope(bytes.slice(messageOffset));
    const actionPrototype = envelope.methodName === ".lq.ActionPrototype" ? parseActionPrototype(envelope.payloadBytes) : null;
    const directActionName = actionPrototype ? null : actionNameFromMethod(envelope.methodName);
    const actionName = actionPrototype?.actionName || directActionName;
    const actionPayloadBytes = actionPrototype?.actionPayloadBytes || (directActionName ? envelope.payloadBytes : new Uint8Array());
    const actionPayloadFields = actionPrototype?.actionPayloadFields || (directActionName ? summarizePayloadFields(actionPayloadBytes) : void 0);
    const restoreActionNames = extractRestoreActionNames(envelope.methodName, envelope.payloadBytes);
    const publicEnvelope = {
      frameType,
      frameTypeName,
      requestId,
      methodName: envelope.methodName,
      actionName,
      restoreActionNames: restoreActionNames ? restoreActionNames.slice(0, 20) : void 0,
      step: actionPrototype?.step,
      payloadLength: envelope.payloadBytes.length,
      payloadSample: bytesToHex(envelope.payloadBytes, BINARY_ENVELOPE_SAMPLE_BYTES),
      payloadTruncated: envelope.payloadBytes.length > BINARY_ENVELOPE_SAMPLE_BYTES,
      actionPayloadLength: actionName ? actionPayloadBytes.length : void 0,
      actionPayloadSample: actionName ? bytesToHex(actionPayloadBytes, BINARY_ENVELOPE_SAMPLE_BYTES) : void 0,
      actionPayloadTruncated: actionName ? actionPayloadBytes.length > BINARY_ENVELOPE_SAMPLE_BYTES : void 0,
      actionPayloadFields
    };
    return {
      envelope: publicEnvelope,
      payloadBytes: envelope.payloadBytes,
      actionPayloadBytes
    };
  }
  function parseBinaryEnvelope(data) {
    return parseBinaryFrame(data)?.envelope || null;
  }
  function parseReadableMessage(data) {
    if (typeof data !== "string") return [];
    const parsed = tryParseJsonText(data);
    if (!parsed) return [];
    const messages = Array.isArray(parsed) ? parsed : [parsed];
    const events = [];
    for (const message of messages) {
      const envelope = extractEnvelope(message);
      if (!envelope) continue;
      const type = toEventType(envelope.name);
      if (!type) continue;
      events.push(...expandStandardEvents(type, normalizePayload(type, envelope.payload, envelope.name)));
    }
    return events;
  }
  function parseDecodedMessage(data) {
    const messages = Array.isArray(data) ? data : [data];
    const events = [];
    for (const message of messages) {
      const envelope = buildDecodedEnvelope(message);
      if (!envelope) continue;
      const type = toEventType(envelope.name);
      if (!type) continue;
      const payload = normalizePayload(type, envelope.payload, envelope.name);
      events.push(...expandStandardEvents(type, {
        ...payload,
        binaryEnvelope: decodedBinaryEnvelope(envelope)
      }));
    }
    return events;
  }
  function parseBinaryMessage(data) {
    const frame = parseBinaryFrame(data);
    const envelope = frame?.envelope;
    if (!envelope?.methodName) return [];
    if (isGameRestoreMethod(envelope.methodName)) {
      return parseGameRestoreMessage(envelope, frame.payloadBytes);
    }
    if (isGameRestoreCarrierMethod(envelope.methodName)) {
      return parseGameRestoreCarrierMessage(envelope, frame.payloadBytes);
    }
    const actionName = envelope.actionName;
    if (!actionName) return [];
    const type = toEventType(actionName || envelope.methodName);
    if (!type) return [];
    const actionPayload = actionName ? decodeSimpleActionPayload(actionName, frame.actionPayloadBytes) : {};
    return expandStandardEvents(type, {
      ...actionPayload,
      binaryEnvelope: envelope
    });
  }

  // src/core/events.js
  var STANDARD_GAME_EVENT_TYPES = /* @__PURE__ */ new Set([
    "round_start",
    "deal_hand",
    "draw_tile",
    "discard_tile",
    "call_meld",
    "riichi",
    "dora",
    "round_end"
  ]);
  function isStandardGameEvent(type) {
    return STANDARD_GAME_EVENT_TYPES.has(type);
  }

  // src/adapter/majsoulAdapter.js
  var DEFAULT_BINARY_SAMPLE_BYTES = 4096;
  var DEFAULT_MAX_EVENTS = 3e3;
  var MAX_CAPTURE_EVENTS = 3e3;
  var RUNTIME_SHAPE_KEY_LIMIT = 40;
  var RUNTIME_SHAPE_ACCESSOR_LIMIT = 20;
  var SELF_TEST_DISCARD_SAMPLE = "01 0a 13 2e 6c 71 2e 41 63 74 69 6f 6e 50 72 6f 74 6f 74 79 70 65 12 1f 08 35 12 11 41 63 74 69 6f 6e 44 69 73 63 61 72 64 54 69 6c 65 1a 08 08 03 12 02 39 73 28 01";
  function createHookDiagnostics() {
    return {
      constructor: false,
      constructorStatics: {
        copied: 0,
        failed: []
      },
      prototypeConstructor: "not-installed",
      send: false,
      addEventListener: false,
      removeEventListener: false,
      onmessage: false,
      onmessageMode: "not-installed",
      decodedMessage: false,
      decodedMessageMode: "not-installed",
      decodedMessageAttempts: 0,
      decodedMessageFailureReason: "",
      decodedDispatcher: false,
      decodedDispatcherMode: "not-installed",
      decodedDispatcherAttempts: 0,
      decodedDispatcherFailureReason: ""
    };
  }
  function createUnityRuntimeState() {
    return {
      instance: null,
      createUnityInstanceLoadObserver: false,
      createUnityInstanceLoadEvents: 0,
      createUnityInstanceLastScript: "",
      createUnityInstanceHook: false,
      createUnityInstanceMode: "not-installed",
      createUnityInstanceAttempts: 0,
      createUnityInstanceCalls: 0,
      createUnityInstanceResolved: false,
      createUnityInstanceFailureReason: ""
    };
  }
  function copyConstructorStatics(target, source) {
    const result = { copied: 0, failed: [] };
    const skippedKeys = /* @__PURE__ */ new Set(["prototype", "length", "name"]);
    for (const key of Reflect.ownKeys(source)) {
      if (skippedKeys.has(key)) continue;
      const descriptor = Object.getOwnPropertyDescriptor(source, key);
      if (!descriptor) continue;
      try {
        Object.defineProperty(target, key, descriptor);
        result.copied += 1;
      } catch {
        result.failed.push(String(key));
      }
    }
    return result;
  }
  function patchPrototypeConstructor(prototype, constructor, restoreFns) {
    const descriptor = Object.getOwnPropertyDescriptor(prototype, "constructor");
    try {
      Object.defineProperty(prototype, "constructor", {
        configurable: true,
        writable: true,
        value: constructor
      });
      restoreFns.push(() => {
        if (descriptor) {
          Object.defineProperty(prototype, "constructor", descriptor);
        } else {
          delete prototype.constructor;
        }
      });
      return "patched";
    } catch (error) {
      return `failed: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
  function getPageDiagnostics() {
    const location = globalThis.location;
    if (!location) {
      return {
        origin: "",
        host: "",
        pathname: "",
        sanitizedUrl: ""
      };
    }
    const origin = String(location.origin || "");
    const host = String(location.host || "");
    const pathname = String(location.pathname || "");
    return {
      origin,
      host,
      pathname,
      sanitizedUrl: `${origin}${pathname}`
    };
  }
  function getRuntimeDiagnostics(unityRuntime = {}) {
    const unityInstance = unityRuntime.instance || globalThis.unityInstance || globalThis.gameInstance || null;
    const unityModule = unityInstance?.Module || null;
    const unityInstanceShape = summarizeRuntimeObjectShape(unityInstance);
    const unityModuleShape = summarizeRuntimeObjectShape(unityModule);
    const unityBuildScript = getScriptSources().find((src) => /WebGL-release|\.loader\.js|\.framework\.js|\.wasm/i.test(src)) || "";
    const unityCanvas = safeQuerySelector("#unity-canvas") || safeQuerySelector("canvas");
    return {
      unityWebGL: Boolean(unityBuildScript || unityInstance || unityCanvas?.id === "unity-canvas"),
      unityBuildScript: sanitizeUrl(unityBuildScript),
      hasUnityInstance: Boolean(unityInstance),
      hasUnityModule: Boolean(unityModule),
      heapU8: Boolean(unityModule?.HEAPU8),
      sendMessageAvailable: Boolean(unityInstance?.SendMessage || unityModule?.SendMessage),
      unityInstanceShape,
      unityModuleShape,
      createUnityInstanceLoadObserver: Boolean(unityRuntime.createUnityInstanceLoadObserver),
      createUnityInstanceLoadEvents: unityRuntime.createUnityInstanceLoadEvents ?? 0,
      createUnityInstanceLastScript: unityRuntime.createUnityInstanceLastScript || "",
      createUnityInstanceHook: Boolean(unityRuntime.createUnityInstanceHook),
      createUnityInstanceMode: unityRuntime.createUnityInstanceMode || "not-installed",
      createUnityInstanceAttempts: unityRuntime.createUnityInstanceAttempts ?? 0,
      createUnityInstanceCalls: unityRuntime.createUnityInstanceCalls ?? 0,
      createUnityInstanceResolved: Boolean(unityRuntime.createUnityInstanceResolved),
      createUnityInstanceFailureReason: unityRuntime.createUnityInstanceFailureReason || "",
      netMessageWrapperGlobal: typeof globalThis.net?.MessageWrapper?.decodeMessage === "function",
      layaGlobal: Boolean(globalThis.Laya?.EventDispatcher)
    };
  }
  function summarizeRuntimeObjectShape(value) {
    const own = summarizeRuntimeObjectLevel(value);
    const prototype = summarizeRuntimeObjectLevel(safeGetPrototype(value), {
      keyLimit: 20,
      accessorLimit: 10
    });
    return {
      keyCount: own.keyCount,
      keys: own.keys,
      functionKeyCount: own.functionKeyCount,
      functionKeys: own.functionKeys,
      accessorKeyCount: own.accessorKeyCount,
      accessorKeys: own.accessorKeys,
      unavailableReason: own.unavailableReason,
      prototypeKeyCount: prototype.keyCount,
      prototypeKeys: prototype.keys,
      prototypeFunctionKeyCount: prototype.functionKeyCount,
      prototypeFunctionKeys: prototype.functionKeys,
      prototypeAccessorKeyCount: prototype.accessorKeyCount,
      prototypeAccessorKeys: prototype.accessorKeys,
      prototypeUnavailableReason: prototype.unavailableReason
    };
  }
  function summarizeRuntimeObjectLevel(value, {
    keyLimit = RUNTIME_SHAPE_KEY_LIMIT,
    accessorLimit = RUNTIME_SHAPE_ACCESSOR_LIMIT
  } = {}) {
    const empty = {
      keyCount: 0,
      keys: [],
      functionKeyCount: 0,
      functionKeys: [],
      accessorKeyCount: 0,
      accessorKeys: [],
      unavailableReason: ""
    };
    if (!value || typeof value !== "object" && typeof value !== "function") return empty;
    let descriptors;
    try {
      descriptors = Object.getOwnPropertyDescriptors(value);
    } catch (error) {
      return {
        ...empty,
        unavailableReason: safeParseError(error)
      };
    }
    const keys = Reflect.ownKeys(descriptors);
    const names = keys.map(sanitizeDiagnosticKey);
    const functionKeys = [];
    const accessorKeys = [];
    for (const key of keys) {
      const descriptor = descriptors[key];
      const name = sanitizeDiagnosticKey(key);
      if (typeof descriptor?.value === "function") functionKeys.push(name);
      if (descriptor?.get || descriptor?.set) accessorKeys.push(name);
    }
    return {
      keyCount: keys.length,
      keys: names.slice(0, keyLimit),
      functionKeyCount: functionKeys.length,
      functionKeys: functionKeys.slice(0, keyLimit),
      accessorKeyCount: accessorKeys.length,
      accessorKeys: accessorKeys.slice(0, accessorLimit),
      unavailableReason: ""
    };
  }
  function safeGetPrototype(value) {
    if (!value || typeof value !== "object" && typeof value !== "function") return null;
    try {
      return Object.getPrototypeOf(value);
    } catch {
      return null;
    }
  }
  function sanitizeDiagnosticKey(key) {
    const text = typeof key === "symbol" ? key.toString() : String(key);
    const withoutUrlSecret = text.includes("://") ? sanitizeUrl(text) : text.split("#")[0].split("?")[0];
    return withoutUrlSecret.slice(0, 120);
  }
  function getScriptSources() {
    try {
      return Array.from(globalThis.document?.scripts || []).map((script) => String(script?.src || "")).filter(Boolean);
    } catch {
      return [];
    }
  }
  function isUnityLoaderScript(src = "") {
    return /(?:unity|webgl|\.loader\.js|\.framework\.js|\.wasm)/i.test(String(src || ""));
  }
  function safeQuerySelector(selector) {
    try {
      return globalThis.document?.querySelector?.(selector) || null;
    } catch {
      return null;
    }
  }
  function sanitizeUrl(value = "") {
    const raw = String(value || "");
    if (!raw) return "";
    try {
      const url = new URL(raw, globalThis.location?.href || void 0);
      return `${url.origin}${url.pathname}`;
    } catch {
      return raw.split("#")[0].split("?")[0];
    }
  }
  function safeParseError(error) {
    return error instanceof Error ? error.message : String(error);
  }
  function summarizeBinaryEnvelope(data) {
    try {
      return { envelope: parseBinaryEnvelope(data) };
    } catch (error) {
      return {
        envelope: null,
        envelopeError: safeParseError(error)
      };
    }
  }
  function parseStandardMessagesSafely(data) {
    const events = [];
    const errors = [];
    try {
      events.push(...parseReadableMessage(data));
    } catch (error) {
      errors.push(`readable: ${safeParseError(error)}`);
    }
    try {
      events.push(...parseBinaryMessage(data));
    } catch (error) {
      errors.push(`binary: ${safeParseError(error)}`);
    }
    return {
      events,
      parseError: errors.join("; ")
    };
  }
  function summarizeMessage(data, { binarySampleBytes = DEFAULT_BINARY_SAMPLE_BYTES } = {}) {
    if (typeof data === "string") {
      return {
        kind: "text",
        length: data.length,
        preview: data.slice(0, 240),
        sample: data.slice(0, 4e3),
        truncated: data.length > 4e3
      };
    }
    if (data instanceof ArrayBuffer) {
      const sampleLength = normalizeSampleBytes(binarySampleBytes);
      const envelopeSummary = summarizeBinaryEnvelope(data);
      return {
        kind: "arraybuffer",
        length: data.byteLength,
        preview: `ArrayBuffer(${data.byteLength})`,
        sample: bytesToHex2(new Uint8Array(data.slice(0, sampleLength))),
        truncated: data.byteLength > sampleLength,
        ...envelopeSummary
      };
    }
    if (ArrayBuffer.isView(data)) {
      const sampleLength = normalizeSampleBytes(binarySampleBytes);
      const bytes = new Uint8Array(data.buffer, data.byteOffset, Math.min(data.byteLength, sampleLength));
      const envelopeSummary = summarizeBinaryEnvelope(data);
      return {
        kind: data.constructor.name,
        length: data.byteLength,
        preview: `${data.constructor.name}(${data.byteLength})`,
        sample: bytesToHex2(bytes),
        truncated: data.byteLength > sampleLength,
        ...envelopeSummary
      };
    }
    if (typeof Blob !== "undefined" && data instanceof Blob) {
      return {
        kind: "blob",
        length: data.size,
        preview: `Blob(${data.size}, ${data.type || "unknown"})`,
        sample: "",
        truncated: false,
        asyncSamplePending: data.size > 0,
        sampleUnavailableReason: data.size > 0 ? "blob-async" : ""
      };
    }
    return {
      kind: typeof data,
      length: 0,
      preview: String(data).slice(0, 240),
      sample: String(data).slice(0, 1e3),
      truncated: String(data).length > 1e3
    };
  }
  function bytesToHex2(bytes) {
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(" ");
  }
  function summarizeBytes(bytes, kind = "blob-arraybuffer", { binarySampleBytes = DEFAULT_BINARY_SAMPLE_BYTES } = {}) {
    const sampleLength = normalizeSampleBytes(binarySampleBytes);
    const sampleBytes = bytes.slice(0, sampleLength);
    const envelopeSummary = summarizeBinaryEnvelope(bytes);
    return {
      kind,
      length: bytes.byteLength,
      preview: `${kind}(${bytes.byteLength})`,
      sample: bytesToHex2(sampleBytes),
      truncated: bytes.byteLength > sampleLength,
      ...envelopeSummary
    };
  }
  function summarizeDecodedMessage(message, hookName, parsedEvents = []) {
    const envelope = firstDecodedEnvelopeSummary(message);
    return {
      hook: hookName,
      name: envelope.name,
      actionName: envelope.actionName,
      payloadKeys: envelope.payloadKeys,
      parsedTypes: parsedEvents.map((event) => event.type),
      parsedCount: parsedEvents.length
    };
  }
  function firstDecodedEnvelopeSummary(message) {
    const first = Array.isArray(message) ? message[0] : message;
    if (!first || typeof first !== "object") {
      return {
        name: "",
        actionName: "",
        payloadKeys: []
      };
    }
    const name = stringValue(
      first.name,
      first.method,
      first.type,
      first.event,
      first.msg,
      first.command,
      first.actionName,
      first.action,
      first.wrapper?.name,
      first.head?.name,
      first.message?.name
    );
    const payload = objectValue(first.data, first.payload, first.result, first.params, first.detail);
    const actionName = stringValue(payload?.name, payload?.actionName, payload?.action);
    return {
      name,
      actionName,
      payloadKeys: payload ? Object.keys(payload).slice(0, 20) : []
    };
  }
  function stringValue(...values) {
    for (const value of values) {
      if (typeof value === "string") return value;
      if (value && typeof value === "object" && typeof value.name === "string") return value.name;
    }
    return "";
  }
  function objectValue(...values) {
    return values.find((value) => value && typeof value === "object" && !ArrayBuffer.isView(value) && !(value instanceof ArrayBuffer));
  }
  function isDecodedGameName(value = "") {
    const text = String(value || "");
    return /(^|\.)(Action|Record)[A-Za-z0-9_]+$/.test(text) || /^\.?lq\.(ActionPrototype|GameRestore|ResSyncGame|ResEnterGame)$/.test(text);
  }
  function hasDecodedGameName(value, depth = 0) {
    if (depth > 4 || value === void 0 || value === null) return false;
    if (typeof value === "string") return isDecodedGameName(value);
    if (typeof value !== "object") return false;
    const direct = [
      value.name,
      value.method,
      value.type,
      value.event,
      value.msg,
      value.command,
      value.actionName,
      value.action,
      value.wrapper?.name,
      value.head?.name,
      value.message?.name,
      value.constructor?.name
    ];
    if (direct.some((entry) => isDecodedGameName(entry))) return true;
    return [
      value.data,
      value.payload,
      value.result,
      value.params,
      value.detail,
      value.message,
      value.wrapper,
      value.head
    ].some((entry) => hasDecodedGameName(entry, depth + 1));
  }
  var MajsoulAdapter = class extends EventTarget {
    constructor({ maxEvents = DEFAULT_MAX_EVENTS, dedupeMs = 25, binarySampleBytes = DEFAULT_BINARY_SAMPLE_BYTES, helperVersion = "" } = {}) {
      super();
      this.helperVersion = helperVersion;
      this.maxEvents = normalizeMaxEvents(maxEvents);
      this.dedupeMs = dedupeMs;
      this.binarySampleBytes = normalizeSampleBytes(binarySampleBytes);
      this.paused = false;
      this.events = [];
      this.recentRawKeys = [];
      this.observedInboundEvents = /* @__PURE__ */ new WeakSet();
      this.installed = false;
      this.installAttempts = 0;
      this.installedAt = null;
      this.installFailureReason = "";
      this.restoreFns = [];
      this.socketRecords = [];
      this.hookDiagnostics = createHookDiagnostics();
      this.unityRuntime = createUnityRuntimeState();
      this.nextEventId = 1;
    }
    install() {
      if (this.installed) return true;
      this.installAttempts += 1;
      if (typeof WebSocket === "undefined") {
        this.installFailureReason = "WebSocket is not available on this page context yet.";
        return false;
      }
      const restoreStart = this.restoreFns.length;
      try {
        this.installed = true;
        this.installedAt = (/* @__PURE__ */ new Date()).toISOString();
        this.installFailureReason = "";
        this.hookDiagnostics = createHookDiagnostics();
        const adapter = this;
        const OriginalWebSocket = WebSocket;
        const originalPrototype = OriginalWebSocket.prototype;
        const originalSend = originalPrototype.send;
        const PatchedWebSocket = function MajsoulHelperWebSocket(...args) {
          const socket = new.target ? Reflect.construct(OriginalWebSocket, args, new.target) : OriginalWebSocket(...args);
          adapter.recordSocket(args[0] || socket.url || "");
          return socket;
        };
        Object.setPrototypeOf(PatchedWebSocket, OriginalWebSocket);
        PatchedWebSocket.prototype = originalPrototype;
        this.hookDiagnostics.constructorStatics = copyConstructorStatics(PatchedWebSocket, OriginalWebSocket);
        globalThis.WebSocket = PatchedWebSocket;
        this.restoreFns.push(() => {
          globalThis.WebSocket = OriginalWebSocket;
        });
        this.hookDiagnostics.prototypeConstructor = patchPrototypeConstructor(
          originalPrototype,
          PatchedWebSocket,
          this.restoreFns
        );
        this.hookDiagnostics.constructor = true;
        originalPrototype.send = function patchedSend(data) {
          const result = originalSend.call(this, data);
          adapter.safeRecordRaw("ws_out", data, this.url);
          return result;
        };
        this.restoreFns.push(() => {
          originalPrototype.send = originalSend;
        });
        this.hookDiagnostics.send = true;
        const originalAddEventListener = originalPrototype.addEventListener;
        const originalRemoveEventListener = originalPrototype.removeEventListener;
        const wrappedListeners = /* @__PURE__ */ new WeakMap();
        const isEventListener = (listener) => typeof listener === "function" || listener && typeof listener === "object" && typeof listener.handleEvent === "function";
        const callEventListener = (listener, thisArg, event) => {
          if (typeof listener === "function") return listener.call(thisArg, event);
          return listener.handleEvent.call(listener, event);
        };
        const listenerCaptureKey = (options) => String(typeof options === "boolean" ? options : Boolean(options?.capture));
        const rememberWrappedListener = (socket, listener, options, wrapped) => {
          let socketListeners = wrappedListeners.get(socket);
          if (!socketListeners) {
            socketListeners = /* @__PURE__ */ new WeakMap();
            wrappedListeners.set(socket, socketListeners);
          }
          let listenerEntries = socketListeners.get(listener);
          if (!listenerEntries) {
            listenerEntries = /* @__PURE__ */ new Map();
            socketListeners.set(listener, listenerEntries);
          }
          listenerEntries.set(listenerCaptureKey(options), wrapped);
        };
        const getWrappedListener = (socket, listener, options) => {
          const socketListeners = wrappedListeners.get(socket);
          const listenerEntries = socketListeners?.get(listener);
          return listenerEntries?.get(listenerCaptureKey(options));
        };
        const takeWrappedListener = (socket, listener, options) => {
          const socketListeners = wrappedListeners.get(socket);
          const listenerEntries = socketListeners?.get(listener);
          const wrapped = listenerEntries?.get(listenerCaptureKey(options));
          if (wrapped) listenerEntries.delete(listenerCaptureKey(options));
          return wrapped;
        };
        originalPrototype.addEventListener = function patchedAddEventListener(type, listener, options) {
          if (type !== "message" || !isEventListener(listener)) {
            return originalAddEventListener.call(this, type, listener, options);
          }
          const socket = this;
          const existing = getWrappedListener(socket, listener, options);
          if (existing) {
            return originalAddEventListener.call(this, type, existing, options);
          }
          const wrapped = function wrappedMessageListener(event) {
            adapter.safeRecordRaw("ws_in", event.data, socket.url, event);
            return callEventListener(listener, this, event);
          };
          rememberWrappedListener(socket, listener, options, wrapped);
          return originalAddEventListener.call(this, type, wrapped, options);
        };
        this.restoreFns.push(() => {
          originalPrototype.addEventListener = originalAddEventListener;
        });
        this.hookDiagnostics.addEventListener = true;
        originalPrototype.removeEventListener = function patchedRemoveEventListener(type, listener, options) {
          if (type !== "message" || !isEventListener(listener)) {
            return originalRemoveEventListener.call(this, type, listener, options);
          }
          return originalRemoveEventListener.call(this, type, takeWrappedListener(this, listener, options) || listener, options);
        };
        this.restoreFns.push(() => {
          originalPrototype.removeEventListener = originalRemoveEventListener;
        });
        this.hookDiagnostics.removeEventListener = true;
        const descriptor = Object.getOwnPropertyDescriptor(originalPrototype, "onmessage");
        if (descriptor && descriptor.configurable && typeof descriptor.set === "function") {
          const onMessageHandlers = /* @__PURE__ */ new WeakMap();
          Object.defineProperty(originalPrototype, "onmessage", {
            configurable: true,
            enumerable: descriptor.enumerable,
            get() {
              return onMessageHandlers.get(this)?.handler || descriptor.get.call(this);
            },
            set(handler) {
              if (typeof handler !== "function") {
                onMessageHandlers.delete(this);
                descriptor.set.call(this, handler);
                return;
              }
              const socket = this;
              const wrapped = function patchedOnMessage(event) {
                adapter.safeRecordRaw("ws_in", event.data, socket.url, event);
                return handler.call(this, event);
              };
              onMessageHandlers.set(this, { handler, wrapped });
              descriptor.set.call(this, wrapped);
            }
          });
          this.restoreFns.push(() => {
            Object.defineProperty(originalPrototype, "onmessage", descriptor);
          });
          this.hookDiagnostics.onmessage = true;
          this.hookDiagnostics.onmessageMode = "accessor";
        } else if (!descriptor || descriptor.configurable) {
          const onMessageHandlers = /* @__PURE__ */ new WeakMap();
          Object.defineProperty(originalPrototype, "onmessage", {
            configurable: true,
            enumerable: descriptor?.enumerable ?? true,
            get() {
              return onMessageHandlers.get(this)?.handler || null;
            },
            set(handler) {
              const previous = onMessageHandlers.get(this);
              if (previous?.wrapped) {
                originalRemoveEventListener.call(this, "message", previous.wrapped);
              }
              if (typeof handler !== "function") {
                onMessageHandlers.delete(this);
                return;
              }
              const socket = this;
              const wrapped = function fallbackOnMessage(event) {
                adapter.safeRecordRaw("ws_in", event.data, socket.url, event);
                return handler.call(this, event);
              };
              onMessageHandlers.set(this, { handler, wrapped });
              originalAddEventListener.call(this, "message", wrapped);
            }
          });
          this.restoreFns.push(() => {
            if (descriptor) {
              Object.defineProperty(originalPrototype, "onmessage", descriptor);
            } else {
              delete originalPrototype.onmessage;
            }
          });
          this.hookDiagnostics.onmessage = true;
          this.hookDiagnostics.onmessageMode = descriptor ? "data-descriptor-fallback" : "descriptorless-fallback";
        } else {
          this.hookDiagnostics.onmessage = false;
          this.hookDiagnostics.onmessageMode = "non-configurable";
        }
        this.installDecodedMessageHook();
        this.startDecodedMessageHookRetry();
        this.installDecodedDispatcherHook();
        this.startDecodedDispatcherHookRetry();
        this.installUnityScriptLoadObserver();
        this.installUnityInstanceHook();
        this.startUnityInstanceHookRetry();
        this.dispatchEvent(new CustomEvent("majsoul-helper:install", { detail: this.getInstallDiagnostics() }));
        return true;
      } catch (error) {
        const restoreFns = this.restoreFns.splice(restoreStart).reverse();
        for (const restore of restoreFns) {
          try {
            restore();
          } catch {
          }
        }
        this.installed = false;
        this.installedAt = null;
        this.hookDiagnostics = createHookDiagnostics();
        this.installFailureReason = `WebSocket hook install failed: ${error instanceof Error ? error.message : String(error)}`;
        this.dispatchEvent(new CustomEvent("majsoul-helper:install", { detail: this.getInstallDiagnostics() }));
        return false;
      }
    }
    uninstall() {
      for (const restore of this.restoreFns.reverse()) restore();
      this.restoreFns = [];
      this.installed = false;
      this.installedAt = null;
      this.hookDiagnostics = createHookDiagnostics();
      this.unityRuntime = createUnityRuntimeState();
    }
    installUnityScriptLoadObserver() {
      const target = globalThis.document || globalThis;
      if (this.unityRuntime.createUnityInstanceLoadObserver || typeof target?.addEventListener !== "function") return false;
      const adapter = this;
      function onScriptLoad(event) {
        const script = event?.target;
        const src = String(script?.src || "");
        if (!isUnityLoaderScript(src)) return;
        adapter.unityRuntime.createUnityInstanceLoadEvents += 1;
        adapter.unityRuntime.createUnityInstanceLastScript = sanitizeUrl(src);
        if (!adapter.unityRuntime.createUnityInstanceHook) {
          adapter.installUnityInstanceHook();
        }
        adapter.dispatchEvent(new CustomEvent("majsoul-helper:config", { detail: adapter.getInstallDiagnostics() }));
      }
      target.addEventListener("load", onScriptLoad, true);
      this.restoreFns.push(() => {
        target.removeEventListener?.("load", onScriptLoad, true);
      });
      this.unityRuntime.createUnityInstanceLoadObserver = true;
      if (this.unityRuntime.createUnityInstanceMode === "not-installed") {
        this.unityRuntime.createUnityInstanceMode = "script-load-observer";
      }
      return true;
    }
    installUnityInstanceHook() {
      this.unityRuntime.createUnityInstanceAttempts += 1;
      const originalCreateUnityInstance = globalThis.createUnityInstance;
      if (typeof originalCreateUnityInstance !== "function") {
        this.unityRuntime.createUnityInstanceFailureReason = "createUnityInstance is not available yet.";
        return false;
      }
      if (originalCreateUnityInstance.__majsoulHelperWrapped) {
        this.unityRuntime.createUnityInstanceHook = true;
        this.unityRuntime.createUnityInstanceMode = "already-wrapped";
        this.unityRuntime.createUnityInstanceFailureReason = "";
        return true;
      }
      const adapter = this;
      function wrappedCreateUnityInstance(...args) {
        adapter.unityRuntime.createUnityInstanceCalls += 1;
        let result;
        try {
          result = originalCreateUnityInstance.apply(this, args);
        } catch (error) {
          adapter.unityRuntime.createUnityInstanceFailureReason = `createUnityInstance threw: ${safeParseError(error)}`;
          adapter.dispatchEvent(new CustomEvent("majsoul-helper:config", { detail: adapter.getInstallDiagnostics() }));
          throw error;
        }
        adapter.observeUnityInstanceResult(result);
        return result;
      }
      Object.defineProperty(wrappedCreateUnityInstance, "__majsoulHelperWrapped", {
        configurable: true,
        value: true
      });
      try {
        globalThis.createUnityInstance = wrappedCreateUnityInstance;
        this.restoreFns.push(() => {
          globalThis.createUnityInstance = originalCreateUnityInstance;
        });
        this.unityRuntime.createUnityInstanceHook = true;
        this.unityRuntime.createUnityInstanceMode = "createUnityInstance";
        this.unityRuntime.createUnityInstanceFailureReason = "";
        this.dispatchEvent(new CustomEvent("majsoul-helper:config", { detail: this.getInstallDiagnostics() }));
        return true;
      } catch (error) {
        this.unityRuntime.createUnityInstanceHook = false;
        this.unityRuntime.createUnityInstanceMode = "failed";
        this.unityRuntime.createUnityInstanceFailureReason = safeParseError(error);
        return false;
      }
    }
    startUnityInstanceHookRetry() {
      if (this.unityRuntime.createUnityInstanceHook || typeof globalThis.setInterval !== "function") return;
      const timer = globalThis.setInterval(() => {
        if (this.unityRuntime.createUnityInstanceHook || this.installUnityInstanceHook()) {
          globalThis.clearInterval(timer);
        }
      }, 250);
      if (typeof timer?.unref === "function") timer.unref();
      this.restoreFns.push(() => {
        globalThis.clearInterval(timer);
      });
    }
    observeUnityInstanceResult(result) {
      if (result && typeof result.then === "function") {
        result.then((instance) => {
          this.recordUnityInstance(instance);
        }).catch((error) => {
          this.unityRuntime.createUnityInstanceFailureReason = `createUnityInstance rejected: ${safeParseError(error)}`;
          this.dispatchEvent(new CustomEvent("majsoul-helper:config", { detail: this.getInstallDiagnostics() }));
        });
        return;
      }
      this.recordUnityInstance(result);
    }
    recordUnityInstance(instance) {
      if (!instance || typeof instance !== "object") return;
      this.unityRuntime.instance = instance;
      this.unityRuntime.createUnityInstanceResolved = true;
      this.unityRuntime.createUnityInstanceFailureReason = "";
      this.dispatchEvent(new CustomEvent("majsoul-helper:config", { detail: this.getInstallDiagnostics() }));
    }
    installDecodedMessageHook() {
      this.hookDiagnostics.decodedMessageAttempts += 1;
      const wrapper = globalThis.net?.MessageWrapper;
      if (!wrapper || typeof wrapper !== "object") {
        this.hookDiagnostics.decodedMessageFailureReason = "net.MessageWrapper is not available yet.";
        return false;
      }
      const originalDecodeMessage = wrapper.decodeMessage;
      if (typeof originalDecodeMessage !== "function") {
        this.hookDiagnostics.decodedMessageFailureReason = "net.MessageWrapper.decodeMessage is not available yet.";
        return false;
      }
      if (originalDecodeMessage.__majsoulHelperWrapped) {
        this.hookDiagnostics.decodedMessage = true;
        this.hookDiagnostics.decodedMessageMode = "already-wrapped";
        this.hookDiagnostics.decodedMessageFailureReason = "";
        return true;
      }
      const adapter = this;
      const descriptor = Object.getOwnPropertyDescriptor(wrapper, "decodeMessage");
      function wrappedDecodeMessage(...args) {
        const result = originalDecodeMessage.apply(this, args);
        adapter.safeRecordDecoded("net.MessageWrapper.decodeMessage", result);
        return result;
      }
      Object.defineProperty(wrappedDecodeMessage, "__majsoulHelperWrapped", {
        configurable: true,
        value: true
      });
      try {
        if (descriptor?.configurable) {
          Object.defineProperty(wrapper, "decodeMessage", {
            ...descriptor,
            value: wrappedDecodeMessage
          });
        } else {
          wrapper.decodeMessage = wrappedDecodeMessage;
        }
        this.restoreFns.push(() => {
          try {
            if (descriptor?.configurable) {
              Object.defineProperty(wrapper, "decodeMessage", descriptor);
            } else {
              wrapper.decodeMessage = originalDecodeMessage;
            }
          } catch {
          }
        });
        this.hookDiagnostics.decodedMessage = true;
        this.hookDiagnostics.decodedMessageMode = "net.MessageWrapper.decodeMessage";
        this.hookDiagnostics.decodedMessageFailureReason = "";
        this.dispatchEvent(new CustomEvent("majsoul-helper:config", { detail: this.getInstallDiagnostics() }));
        return true;
      } catch (error) {
        this.hookDiagnostics.decodedMessage = false;
        this.hookDiagnostics.decodedMessageMode = "failed";
        this.hookDiagnostics.decodedMessageFailureReason = error instanceof Error ? error.message : String(error);
        return false;
      }
    }
    startDecodedMessageHookRetry() {
      if (this.hookDiagnostics.decodedMessage || typeof globalThis.setInterval !== "function") return;
      const timer = globalThis.setInterval(() => {
        if (this.markDecodedMessageNotApplicableForUnity()) {
          globalThis.clearInterval(timer);
          return;
        }
        if (this.hookDiagnostics.decodedMessage || this.installDecodedMessageHook()) {
          globalThis.clearInterval(timer);
        }
      }, 250);
      if (typeof timer?.unref === "function") timer.unref();
      this.restoreFns.push(() => {
        globalThis.clearInterval(timer);
      });
    }
    markDecodedMessageNotApplicableForUnity() {
      const runtime = getRuntimeDiagnostics(this.unityRuntime);
      if (!runtime.unityWebGL || runtime.netMessageWrapperGlobal || this.hookDiagnostics.decodedMessage) return false;
      this.hookDiagnostics.decodedMessageMode = "not-applicable-unity";
      this.hookDiagnostics.decodedMessageFailureReason = "Unity WebGL runtime detected; net.MessageWrapper is not expected on this build.";
      this.dispatchEvent(new CustomEvent("majsoul-helper:config", { detail: this.getInstallDiagnostics() }));
      return true;
    }
    installDecodedDispatcherHook() {
      this.hookDiagnostics.decodedDispatcherAttempts += 1;
      const dispatcherPrototype = globalThis.Laya?.EventDispatcher?.prototype;
      if (!dispatcherPrototype || typeof dispatcherPrototype !== "object") {
        this.hookDiagnostics.decodedDispatcherFailureReason = "Laya.EventDispatcher is not available yet.";
        return false;
      }
      const originalEvent = dispatcherPrototype.event;
      if (typeof originalEvent !== "function") {
        this.hookDiagnostics.decodedDispatcherFailureReason = "Laya.EventDispatcher.prototype.event is not available yet.";
        return false;
      }
      if (originalEvent.__majsoulHelperWrapped) {
        this.hookDiagnostics.decodedDispatcher = true;
        this.hookDiagnostics.decodedDispatcherMode = "already-wrapped";
        this.hookDiagnostics.decodedDispatcherFailureReason = "";
        return true;
      }
      const adapter = this;
      const descriptor = Object.getOwnPropertyDescriptor(dispatcherPrototype, "event");
      function wrappedLayaEvent(type, data, ...args) {
        adapter.safeRecordDecoded("Laya.EventDispatcher.event", data, {
          requireGameLike: true,
          eventType: type
        });
        return originalEvent.call(this, type, data, ...args);
      }
      Object.defineProperty(wrappedLayaEvent, "__majsoulHelperWrapped", {
        configurable: true,
        value: true
      });
      try {
        if (descriptor?.configurable) {
          Object.defineProperty(dispatcherPrototype, "event", {
            ...descriptor,
            value: wrappedLayaEvent
          });
        } else {
          dispatcherPrototype.event = wrappedLayaEvent;
        }
        this.restoreFns.push(() => {
          try {
            if (descriptor?.configurable) {
              Object.defineProperty(dispatcherPrototype, "event", descriptor);
            } else {
              dispatcherPrototype.event = originalEvent;
            }
          } catch {
          }
        });
        this.hookDiagnostics.decodedDispatcher = true;
        this.hookDiagnostics.decodedDispatcherMode = "Laya.EventDispatcher.event";
        this.hookDiagnostics.decodedDispatcherFailureReason = "";
        this.dispatchEvent(new CustomEvent("majsoul-helper:config", { detail: this.getInstallDiagnostics() }));
        return true;
      } catch (error) {
        this.hookDiagnostics.decodedDispatcher = false;
        this.hookDiagnostics.decodedDispatcherMode = "failed";
        this.hookDiagnostics.decodedDispatcherFailureReason = error instanceof Error ? error.message : String(error);
        return false;
      }
    }
    startDecodedDispatcherHookRetry() {
      if (this.hookDiagnostics.decodedDispatcher || typeof globalThis.setInterval !== "function") return;
      const timer = globalThis.setInterval(() => {
        if (this.markDecodedDispatcherNotApplicableForUnity()) {
          globalThis.clearInterval(timer);
          return;
        }
        if (this.hookDiagnostics.decodedDispatcher || this.installDecodedDispatcherHook()) {
          globalThis.clearInterval(timer);
        }
      }, 250);
      if (typeof timer?.unref === "function") timer.unref();
      this.restoreFns.push(() => {
        globalThis.clearInterval(timer);
      });
    }
    markDecodedDispatcherNotApplicableForUnity() {
      const runtime = getRuntimeDiagnostics(this.unityRuntime);
      if (!runtime.unityWebGL || runtime.layaGlobal || this.hookDiagnostics.decodedDispatcher) return false;
      this.hookDiagnostics.decodedDispatcherMode = "not-applicable-unity";
      this.hookDiagnostics.decodedDispatcherFailureReason = "Unity WebGL runtime detected; Laya.EventDispatcher is not expected on this build.";
      this.dispatchEvent(new CustomEvent("majsoul-helper:config", { detail: this.getInstallDiagnostics() }));
      return true;
    }
    setPaused(paused) {
      this.paused = Boolean(paused);
      this.dispatchEvent(new CustomEvent("majsoul-helper:config", { detail: this.getInstallDiagnostics() }));
      return this.paused;
    }
    setBinarySampleBytes(value) {
      this.binarySampleBytes = normalizeSampleBytes(value);
      this.dispatchEvent(new CustomEvent("majsoul-helper:config", { detail: this.getInstallDiagnostics() }));
      return this.binarySampleBytes;
    }
    setMaxEvents(value) {
      this.maxEvents = normalizeMaxEvents(value, this.maxEvents);
      this.events = this.events.slice(0, this.maxEvents);
      this.dispatchEvent(new CustomEvent("majsoul-helper:config", { detail: this.getInstallDiagnostics() }));
      return this.maxEvents;
    }
    recordSocket(url = "") {
      const record = {
        url: sanitizeUrl(url),
        ts: Date.now()
      };
      this.socketRecords = [record, ...this.socketRecords].slice(0, 20);
      this.dispatchEvent(new CustomEvent("majsoul-helper:socket", { detail: record }));
    }
    recordRaw(source, data, url = "", messageEvent = null) {
      if (this.paused) return;
      if (source === "ws_in" && messageEvent && typeof messageEvent === "object") {
        if (this.observedInboundEvents.has(messageEvent)) return;
        this.observedInboundEvents.add(messageEvent);
      }
      const summary = summarizeMessage(data, { binarySampleBytes: this.binarySampleBytes });
      const parsedMessages = parseStandardMessagesSafely(data);
      const now = Date.now();
      if (source === "ws_in" && !messageEvent) {
        const rawKey = `${source}|${url}|${summary.kind}|${summary.length}|${summary.sample || summary.preview}`;
        this.recentRawKeys = this.recentRawKeys.filter((entry) => now - entry.ts <= this.dedupeMs);
        if (this.recentRawKeys.some((entry) => entry.key === rawKey)) return;
        this.recentRawKeys.push({ key: rawKey, ts: now });
      }
      const event = {
        eventId: this.nextEventId++,
        type: "raw_message",
        source,
        ts: now,
        payload: {
          url: sanitizeUrl(url),
          ...summary,
          ...parsedMessages.parseError ? { parseError: parsedMessages.parseError } : {}
        }
      };
      this.events = [event, ...this.events].slice(0, this.maxEvents);
      this.dispatchEvent(new CustomEvent("majsoul-helper:event", { detail: event }));
      for (const parsed of parsedMessages.events) {
        const parsedEvent = {
          ...parsed,
          eventId: this.nextEventId++,
          source,
          ts: now,
          payload: {
            ...parsed.payload,
            rawSummary: event.payload
          }
        };
        this.events = [parsedEvent, ...this.events].slice(0, this.maxEvents);
        this.dispatchEvent(new CustomEvent("majsoul-helper:event", { detail: parsedEvent }));
      }
      if (typeof Blob !== "undefined" && data instanceof Blob && typeof data.arrayBuffer === "function") {
        this.recordBlobBytes(source, data, url, now);
      }
    }
    recordDecoded(hookName, message, { requireGameLike = false, eventType = "" } = {}) {
      if (this.paused) return;
      const parsedEvents = parseDecodedMessage(message);
      if (requireGameLike && !parsedEvents.length && !hasDecodedGameName(eventType) && !hasDecodedGameName(message)) {
        return;
      }
      const now = Date.now();
      const event = {
        eventId: this.nextEventId++,
        type: "decoded_message",
        source: "client_decode",
        ts: now,
        payload: summarizeDecodedMessage(message, hookName, parsedEvents)
      };
      this.events = [event, ...this.events].slice(0, this.maxEvents);
      this.dispatchEvent(new CustomEvent("majsoul-helper:event", { detail: event }));
      for (const parsed of parsedEvents) {
        const parsedEvent = {
          ...parsed,
          eventId: this.nextEventId++,
          source: "client_decode",
          ts: now,
          payload: {
            ...parsed.payload,
            decodedSummary: event.payload
          }
        };
        this.events = [parsedEvent, ...this.events].slice(0, this.maxEvents);
        this.dispatchEvent(new CustomEvent("majsoul-helper:event", { detail: parsedEvent }));
      }
    }
    safeRecordDecoded(hookName, message, options) {
      try {
        this.recordDecoded(hookName, message, options);
      } catch (error) {
        this.recordCaptureError("client_decode", hookName, error);
      }
    }
    safeRecordRaw(source, data, url = "", messageEvent = null) {
      try {
        this.recordRaw(source, data, url, messageEvent);
      } catch (error) {
        this.recordCaptureError(source, url, error);
      }
    }
    recordCaptureError(source, url, error, observedAt = Date.now()) {
      if (this.paused) return;
      try {
        const event = {
          eventId: this.nextEventId++,
          type: "capture_error",
          source,
          ts: observedAt,
          payload: {
            url: sanitizeUrl(url),
            message: error instanceof Error ? error.message : String(error)
          }
        };
        this.events = [event, ...this.events].slice(0, this.maxEvents);
        this.dispatchEvent(new CustomEvent("majsoul-helper:event", { detail: event }));
      } catch {
      }
    }
    async recordBlobBytes(source, blob, url, observedAt) {
      try {
        const bytes = new Uint8Array(await blob.arrayBuffer());
        if (this.paused) return;
        const summary = summarizeBytes(bytes, "blob-arraybuffer", { binarySampleBytes: this.binarySampleBytes });
        const parsedMessages = parseStandardMessagesSafely(bytes);
        const event = {
          eventId: this.nextEventId++,
          type: "raw_message",
          source,
          ts: observedAt,
          payload: {
            url: sanitizeUrl(url),
            asyncSampleFor: "blob-async",
            ...summary,
            ...parsedMessages.parseError ? { parseError: parsedMessages.parseError } : {}
          }
        };
        this.events = [event, ...this.events].slice(0, this.maxEvents);
        this.dispatchEvent(new CustomEvent("majsoul-helper:event", { detail: event }));
        for (const parsed of parsedMessages.events) {
          const parsedEvent = {
            ...parsed,
            eventId: this.nextEventId++,
            source,
            ts: observedAt,
            payload: {
              ...parsed.payload,
              rawSummary: event.payload
            }
          };
          this.events = [parsedEvent, ...this.events].slice(0, this.maxEvents);
          this.dispatchEvent(new CustomEvent("majsoul-helper:event", { detail: parsedEvent }));
        }
      } catch (error) {
        this.recordCaptureError(source, url, error, observedAt);
      }
    }
    getRecentEvents() {
      return [...this.events];
    }
    getInstallDiagnostics({ events = this.events } = {}) {
      return {
        installed: this.installed,
        helperVersion: this.helperVersion,
        installAttempts: this.installAttempts,
        installedAt: this.installedAt,
        installFailureReason: this.installFailureReason,
        webSocketAvailable: typeof WebSocket !== "undefined",
        paused: this.paused,
        hooks: { ...this.hookDiagnostics },
        runtime: getRuntimeDiagnostics(this.unityRuntime),
        socketsCreated: this.socketRecords.length,
        recentSocketUrls: [...new Set(this.socketRecords.map((record) => record.url).filter(Boolean))].slice(0, 5),
        maxEvents: this.maxEvents,
        binarySampleBytes: this.binarySampleBytes,
        eventBuffer: buildEventBufferDiagnostics(events, this.nextEventId, this.maxEvents)
      };
    }
    clearEvents() {
      this.events = [];
      this.recentRawKeys = [];
      this.observedInboundEvents = /* @__PURE__ */ new WeakSet();
      this.nextEventId = 1;
      this.dispatchEvent(new CustomEvent("majsoul-helper:clear", { detail: { ts: Date.now() } }));
    }
    exportCapture({ limit = this.maxEvents } = {}) {
      const normalizedLimit = normalizeLimit(limit, this.maxEvents, this.maxEvents);
      const events = this.getRecentEvents().slice(0, normalizedLimit);
      return {
        exportedAt: (/* @__PURE__ */ new Date()).toISOString(),
        formatVersion: 1,
        helperVersion: this.helperVersion,
        limit: normalizedLimit,
        note: "Majsoul Helper capture export. Contains message summaries/samples only; no messages were modified by the helper.",
        page: getPageDiagnostics(),
        helperDiagnostics: this.getInstallDiagnostics({ events }),
        summary: summarizeCaptureEvents(events),
        events
      };
    }
    runSelfTest() {
      const readableEvents = parseReadableMessage(JSON.stringify({
        name: ".lq.ActionDealTile",
        data: { seat: 0, tile: "5m", leftTileCount: 55 }
      }));
      const binaryBytes = hexToBytes(SELF_TEST_DISCARD_SAMPLE);
      const binaryEnvelope = parseBinaryEnvelope(binaryBytes);
      const binaryEvents = parseBinaryMessage(binaryBytes);
      const result = {
        ranAt: (/* @__PURE__ */ new Date()).toISOString(),
        installed: this.installed,
        webSocketAvailable: typeof WebSocket !== "undefined",
        readableParsedTypes: readableEvents.map((event) => event.type),
        binaryEnvelope: binaryEnvelope ? {
          frameTypeName: binaryEnvelope.frameTypeName,
          methodName: binaryEnvelope.methodName,
          actionName: binaryEnvelope.actionName,
          payloadTruncated: binaryEnvelope.payloadTruncated,
          actionPayloadTruncated: binaryEnvelope.actionPayloadTruncated
        } : null,
        binaryParsedTypes: binaryEvents.map((event) => event.type),
        ok: Boolean(
          readableEvents.some((event) => event.type === "draw_tile" && event.payload.seat === 0 && event.payload.tile === "5m") && binaryEnvelope?.methodName === ".lq.ActionPrototype" && binaryEnvelope?.actionName === "ActionDiscardTile" && binaryEvents.some((event) => event.type === "discard_tile" && event.payload.seat === 3 && event.payload.tile === "9s")
        )
      };
      this.dispatchEvent(new CustomEvent("majsoul-helper:self-test", { detail: result }));
      return result;
    }
  };
  function hexToBytes(hex) {
    if (!hex) return new Uint8Array();
    return new Uint8Array(hex.split(/\s+/).filter(Boolean).map((part) => Number.parseInt(part, 16)));
  }
  function buildEventBufferDiagnostics(events = [], nextEventId = 1, maxEvents = DEFAULT_MAX_EVENTS) {
    const ids = events.map((event) => Number(event?.eventId)).filter((eventId) => Number.isFinite(eventId));
    const oldestEventId = ids.length ? Math.min(...ids) : null;
    const newestEventId = ids.length ? Math.max(...ids) : null;
    return {
      maxEvents,
      retainedEvents: events.length,
      totalEventsSinceClear: Math.max(0, Number(nextEventId) - 1),
      oldestEventId,
      newestEventId,
      droppedBeforeRetained: oldestEventId === null ? 0 : Math.max(0, oldestEventId - 1)
    };
  }
  function summarizeCaptureEvents(events = []) {
    const summary = {
      totalEvents: events.length,
      rawMessages: 0,
      parsedEvents: 0,
      diagnosticEvents: 0,
      bySource: {},
      byKind: {},
      byMethodName: {},
      byActionName: {},
      byParsedType: {},
      byDiagnosticType: {},
      byUnparsedActionName: {}
    };
    const rawActions = {};
    const parsedActions = {};
    for (const event of events) {
      summary.bySource[event.source || "unknown"] = (summary.bySource[event.source || "unknown"] || 0) + 1;
      if (event.type === "raw_message") {
        summary.rawMessages += 1;
        const payload = event.payload || {};
        const kind = payload.kind || "unknown";
        summary.byKind[kind] = (summary.byKind[kind] || 0) + 1;
        const envelope = payloadEnvelope(payload);
        const methodName = envelope?.methodName;
        const actionNames = envelopeActionNames(envelope);
        if (methodName) summary.byMethodName[methodName] = (summary.byMethodName[methodName] || 0) + 1;
        for (const actionName of actionNames) {
          summary.byActionName[actionName] = (summary.byActionName[actionName] || 0) + 1;
          rawActions[actionName] = (rawActions[actionName] || 0) + 1;
        }
      } else if (isStandardGameEvent(event.type)) {
        summary.parsedEvents += 1;
        summary.byParsedType[event.type] = (summary.byParsedType[event.type] || 0) + 1;
        const methodName = event.payload?.binaryEnvelope?.methodName;
        const actionNames = [event.payload?.binaryEnvelope?.actionName].filter(Boolean);
        if (methodName) summary.byMethodName[methodName] = (summary.byMethodName[methodName] || 0) + 1;
        for (const actionName of actionNames) {
          summary.byActionName[actionName] = (summary.byActionName[actionName] || 0) + 1;
          parsedActions[actionName] = (parsedActions[actionName] || 0) + 1;
        }
      } else {
        summary.diagnosticEvents += 1;
        summary.byDiagnosticType[event.type || "unknown"] = (summary.byDiagnosticType[event.type || "unknown"] || 0) + 1;
      }
    }
    for (const [actionName, count] of Object.entries(rawActions)) {
      const missing = count - (parsedActions[actionName] || 0);
      if (missing > 0) summary.byUnparsedActionName[actionName] = missing;
    }
    return summary;
  }
  function payloadEnvelope(payload = {}) {
    if (payload.envelope) return payload.envelope;
    if (!payload.sample || payload.kind === "text") return null;
    try {
      return parseBinaryEnvelope(hexToBytes(payload.sample));
    } catch {
      return null;
    }
  }
  function envelopeActionNames(envelope = {}) {
    return [
      envelope?.actionName,
      ...envelope?.restoreActionNames || []
    ].filter(Boolean);
  }
  function normalizeLimit(limit, fallback, max = Infinity) {
    const value = Number(limit);
    if (!Number.isFinite(value) || value <= 0) return fallback;
    return Math.min(max, Math.max(1, Math.floor(value)));
  }
  function normalizeMaxEvents(value, fallback = DEFAULT_MAX_EVENTS) {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) return fallback;
    return Math.max(1, Math.min(MAX_CAPTURE_EVENTS, Math.floor(number)));
  }
  function normalizeSampleBytes(value) {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) return DEFAULT_BINARY_SAMPLE_BYTES;
    return Math.max(16, Math.min(4096, Math.floor(number)));
  }

  // src/core/tile.js
  var SUIT_OFFSETS = { m: 0, p: 9, s: 18, z: 27 };
  var INDEX_SUITS = ["m", "p", "s", "z"];
  function normalizeTile(tile) {
    if (typeof tile !== "string") {
      throw new Error(`Tile must be a string: ${tile}`);
    }
    if (/^0[mps]$/.test(tile)) {
      return `5${tile[1]}`;
    }
    if (!/^[1-9][mps]$/.test(tile) && !/^[1-7]z$/.test(tile)) {
      throw new Error(`Invalid tile: ${tile}`);
    }
    return tile;
  }
  function tileToIndex(tile) {
    const normalized = normalizeTile(tile);
    const value = Number(normalized[0]);
    const suit = normalized[1];
    return SUIT_OFFSETS[suit] + value - 1;
  }
  function indexToTile(index) {
    if (!Number.isInteger(index) || index < 0 || index > 33) {
      throw new Error(`Invalid tile index: ${index}`);
    }
    if (index < 27) {
      const suit = INDEX_SUITS[Math.floor(index / 9)];
      return `${index % 9 + 1}${suit}`;
    }
    return `${index - 26}z`;
  }
  function tilesToCounts(tiles) {
    const counts = Array(34).fill(0);
    for (const tile of tiles) {
      counts[tileToIndex(tile)] += 1;
    }
    return counts;
  }
  function parseTiles(input) {
    if (typeof input !== "string") {
      throw new Error("Tile input must be a string");
    }
    const compactInput = input.trim().replace(/[\s,，、]+/g, "");
    const tiles = [];
    let digits = "";
    for (const char of compactInput) {
      if (/\d/.test(char)) {
        digits += char;
        continue;
      }
      if (!["m", "p", "s", "z"].includes(char)) {
        throw new Error(`Invalid suit: ${char}`);
      }
      if (!digits) {
        throw new Error(`Missing tile number before ${char}`);
      }
      for (const digit of digits) {
        if (digit === "0" && !["m", "p", "s"].includes(char)) {
          throw new Error("Red five is only valid for m/p/s");
        }
        tiles.push(normalizeTile(`${digit}${char}`));
      }
      digits = "";
    }
    if (digits) {
      throw new Error("Dangling tile number without suit");
    }
    return tiles;
  }
  function sortTiles(tiles) {
    return [...tiles].sort((a, b) => tileToIndex(a) - tileToIndex(b));
  }
  function allTileTypes() {
    return Array.from({ length: 34 }, (_, index) => indexToTile(index));
  }
  function doraFromIndicator(indicator) {
    const normalized = normalizeTile(indicator);
    const value = Number(normalized[0]);
    const suit = normalized[1];
    if (suit === "z") {
      if (value <= 4) return `${value === 4 ? 1 : value + 1}z`;
      return `${value === 7 ? 5 : value + 1}z`;
    }
    return `${value === 9 ? 1 : value + 1}${suit}`;
  }

  // src/core/gameState.js
  var INITIAL_STATE = {
    hand: [],
    drawnTile: null,
    melds: [[], [], [], []],
    discards: [[], [], [], []],
    doraIndicators: [],
    round: null,
    chang: null,
    ju: null,
    honba: 0,
    riichiSticks: 0,
    seatWind: null,
    roundWind: null,
    currentTurn: null,
    leftTileCount: null,
    lastStep: null,
    roundEndReason: null,
    riichi: [false, false, false, false],
    scores: [25e3, 25e3, 25e3, 25e3],
    scoresKnown: false,
    invalidTiles: [],
    events: []
  };
  var GameState = class {
    constructor() {
      this.state = structuredClone(INITIAL_STATE);
    }
    reset(partial = {}) {
      this.state = { ...structuredClone(INITIAL_STATE), ...partial };
    }
    clearEvents() {
      this.state.events = [];
    }
    applyEvent(event) {
      if (!event || !event.type) return;
      if (!isStandardGameEvent(event.type)) return;
      if (event.type !== "raw_message") {
        this.state.events = [event, ...this.state.events].slice(0, 100);
      }
      const payload = event.payload || {};
      if (payload.binaryEnvelope?.step !== void 0) {
        this.state.lastStep = payload.binaryEnvelope.step;
      }
      switch (event.type) {
        case "round_start": {
          const nextStateDiagnostics = { invalidTiles: [] };
          this.reset({
            round: payload.round ?? null,
            chang: normalizeRoundIndex(payload.chang),
            ju: normalizeRoundIndex(payload.ju),
            honba: payload.honba ?? 0,
            riichiSticks: payload.riichiSticks ?? 0,
            roundWind: payload.roundWind ?? roundWindFromChang(payload.chang) ?? null,
            seatWind: payload.seatWind ?? seatWindFromJu(payload.ju) ?? null,
            scores: payload.scores ?? [25e3, 25e3, 25e3, 25e3],
            scoresKnown: Array.isArray(payload.scores) && payload.scores.length > 0,
            hand: sanitizeTiles(payload.tiles ?? [], nextStateDiagnostics, "round_start.tiles"),
            melds: sanitizeSeatMelds(payload.melds, nextStateDiagnostics, "round_start.melds"),
            discards: sanitizeSeatTiles(payload.discards, nextStateDiagnostics, "round_start.discards"),
            doraIndicators: sanitizeTiles(payload.doraIndicators ?? [], nextStateDiagnostics, "round_start.doraIndicators"),
            currentTurn: normalizeSeat(payload.currentTurn) ?? null,
            leftTileCount: payload.leftTileCount ?? null,
            riichi: normalizeRiichi(payload.riichi),
            invalidTiles: nextStateDiagnostics.invalidTiles,
            events: this.state.events
          });
          break;
        }
        case "deal_hand":
          this.state.hand = sanitizeTiles(payload.tiles || [], this.state, "deal_hand.tiles");
          this.state.drawnTile = null;
          break;
        case "draw_tile": {
          if (!payload.tile) break;
          const tile = sanitizeTile(payload.tile, this.state, "draw_tile.tile");
          if (!tile) break;
          if (normalizeSeat(payload.seat) === void 0) {
            mergeDoraIndicatorList(this.state, payload.doraIndicators);
            this.state.leftTileCount = payload.leftTileCount ?? this.state.leftTileCount;
            break;
          }
          if (normalizeSeat(payload.seat) === 0) this.state.drawnTile = tile;
          this.state.currentTurn = normalizeSeat(payload.seat);
          this.state.leftTileCount = payload.leftTileCount ?? this.state.leftTileCount;
          mergeDoraIndicatorList(this.state, payload.doraIndicators);
          break;
        }
        case "discard_tile": {
          if (!payload.tile) break;
          const tile = sanitizeTile(payload.tile, this.state, "discard_tile.tile");
          if (!tile) break;
          if (normalizeSeat(payload.seat) === void 0) {
            mergeDoraIndicatorList(this.state, payload.doraIndicators);
            break;
          }
          this.state.discards[normalizeSeat(payload.seat)].push(tile);
          this.state.currentTurn = null;
          if (payload.isRiichi) {
            this.state.riichi[normalizeSeat(payload.seat)] = true;
          }
          mergeDoraIndicatorList(this.state, payload.doraIndicators);
          if (normalizeSeat(payload.seat) === 0) {
            if (this.state.drawnTile && tileToIndex(this.state.drawnTile) === tileToIndex(tile)) {
              this.state.drawnTile = null;
            } else {
              const drawnTile = this.state.drawnTile;
              const discardIndex = tileToIndex(tile);
              let removed = false;
              this.state.hand = this.state.hand.filter((tile2) => {
                if (!removed && tileToIndex(tile2) === discardIndex) {
                  removed = true;
                  return false;
                }
                return true;
              });
              if (drawnTile) {
                this.state.hand.push(drawnTile);
                this.state.drawnTile = null;
              }
            }
          }
          break;
        }
        case "call_meld": {
          if (normalizeSeat(payload.seat) === void 0) break;
          const callerSeat = normalizeSeat(payload.seat);
          const actionName = payload.binaryEnvelope?.actionName;
          const isBaBei = isBaBeiAction(actionName, payload.type);
          const normalizedMeld = normalizeMeld(isBaBei && !payload.meld ? ["4z"] : payload.meld, this.state);
          const meld = isAnGangAddGangAction(actionName) ? normalizeKanMeld(normalizedMeld, payload.type) : normalizedMeld;
          mergeDoraIndicatorList(this.state, payload.doraIndicators);
          this.state.currentTurn = callerSeat;
          if (!meld.length) break;
          const upgradedAddedKan = isAnGangAddGangAction(actionName) && upgradeAddedKanMeld(this.state, callerSeat, meld, payload.type);
          if (!upgradedAddedKan) {
            this.state.melds[callerSeat].push(meld);
          }
          if (isChiPengGangAction(actionName)) {
            const claimedTile = removeClaimedDiscard(this.state, meld, callerSeat);
            if (callerSeat === 0) {
              removeOwnMeldTiles(this.state, meld, claimedTile);
            }
          }
          if (isAnGangAddGangAction(actionName) && callerSeat === 0) {
            removeOwnKnownTiles(this.state, meld);
          }
          if (isBaBei && callerSeat === 0) {
            removeOwnKnownTile(this.state, "4z");
          }
          break;
        }
        case "riichi":
          if (normalizeSeat(payload.seat) === void 0) break;
          applyRiichiSuccess(this.state, payload);
          break;
        case "dora":
          {
            const doraTiles = payload.tile ? [payload.tile] : payload.doraIndicators;
            if (!doraTiles?.length) break;
            appendDoraIndicators(this.state, doraTiles);
          }
          break;
        case "round_end":
          this.state.currentTurn = null;
          this.state.roundEndReason = payload.reason ?? payload.type ?? "ended";
          mergeDoraIndicatorList(this.state, payload.doraIndicators);
          if (payload.scores?.length) {
            this.state.scores = payload.scores;
            this.state.scoresKnown = true;
          }
          break;
        default:
          break;
      }
    }
    getVisibleState() {
      const visible = structuredClone(this.state);
      visible.visibleTiles = collectVisibleTiles(visible);
      visible.warnings = buildWarnings(visible);
      return visible;
    }
  };
  function applyRiichiSuccess(state, payload) {
    const seat = normalizeSeat(payload.seat);
    if (seat === void 0) return;
    state.riichi[seat] = true;
    if (payload.riichiSticks !== void 0) {
      state.riichiSticks = payload.riichiSticks;
    }
    if (payload.score !== void 0 && Number.isFinite(Number(payload.score))) {
      state.scores[seat] = Number(payload.score);
      state.scoresKnown = true;
    }
  }
  function normalizeRoundIndex(value) {
    if (value === void 0 || value === null) return null;
    const number = Number(value);
    return Number.isInteger(number) && number >= 0 ? number : null;
  }
  function roundWindFromChang(chang) {
    const winds = ["E", "S", "W", "N"];
    const index = normalizeRoundIndex(chang);
    return index === null ? null : winds[index] ?? null;
  }
  function seatWindFromJu(ju) {
    const winds = ["E", "S", "W", "N"];
    const dealerSeat = normalizeRoundIndex(ju);
    if (dealerSeat === null || dealerSeat > 3) return null;
    return winds[(4 - dealerSeat) % 4];
  }
  function normalizeSeat(seat) {
    if (seat === void 0 || seat === null) return void 0;
    const value = Number(seat);
    return Number.isInteger(value) && value >= 0 && value <= 3 ? value : void 0;
  }
  function normalizeMeld(meld, state) {
    if (!meld) return [];
    return sanitizeTiles(Array.isArray(meld) ? meld : [meld], state, "call_meld.meld");
  }
  function isChiPengGangAction(actionName) {
    return actionName === "ActionChiPengGang" || actionName === "RecordChiPengGang";
  }
  function isAnGangAddGangAction(actionName) {
    return actionName === "ActionAnGangAddGang" || actionName === "RecordAnGangAddGang";
  }
  function isBaBeiAction(actionName, type) {
    return actionName === "ActionBaBei" || actionName === "RecordBaBei" || type === "babei";
  }
  function sanitizeSeatTiles(value, state, context) {
    const result = [[], [], [], []];
    for (let seat = 0; seat < result.length; seat += 1) {
      result[seat] = sanitizeTiles(value?.[seat] || [], state, `${context}.${seat}`);
    }
    return result;
  }
  function sanitizeSeatMelds(value, state, context) {
    const result = [[], [], [], []];
    for (let seat = 0; seat < result.length; seat += 1) {
      result[seat] = (value?.[seat] || []).map((meld, meldIndex) => sanitizeTiles(Array.isArray(meld) ? meld : [meld], state, `${context}.${seat}.${meldIndex}`)).filter((meld) => meld.length);
    }
    return result;
  }
  function normalizeRiichi(value) {
    const result = [false, false, false, false];
    for (let seat = 0; seat < result.length; seat += 1) {
      result[seat] = Boolean(value?.[seat]);
    }
    return result;
  }
  function normalizeKanMeld(meld, type) {
    if (!meld.length) return [];
    if (Number(type) === 3 && meld.length === 1) {
      return [meld[0], meld[0], meld[0], meld[0]];
    }
    return meld;
  }
  function upgradeAddedKanMeld(state, seat, meld, type) {
    if (Number(type) !== 2 || meld.length !== 1) return false;
    const targetIndex = tileToIndex(meld[0]);
    const existing = state.melds[seat].find((entry) => entry.length >= 3 && entry.length < 4 && entry.every((tile) => tileToIndex(tile) === targetIndex));
    if (!existing) return false;
    existing.push(meld[0]);
    return true;
  }
  function collectVisibleTiles(state) {
    return [
      ...state.doraIndicators,
      ...state.discards.flat(),
      ...state.melds.flat(2)
    ].filter(Boolean);
  }
  function appendDoraIndicators(state, tiles = []) {
    for (const tile of sanitizeTiles(tiles || [], state, "doraIndicators")) {
      if (tile) {
        state.doraIndicators.push(tile);
      }
    }
  }
  function mergeDoraIndicatorList(state, tiles = []) {
    const sanitized = sanitizeTiles(tiles || [], state, "doraIndicators");
    if (!sanitized.length) return;
    const currentCounts = countTilesByName(state.doraIndicators);
    const incomingCounts = countTilesByName(sanitized);
    for (const tile of sanitized) {
      if ((incomingCounts[tile] || 0) > (currentCounts[tile] || 0)) {
        state.doraIndicators.push(tile);
        currentCounts[tile] = (currentCounts[tile] || 0) + 1;
      }
    }
  }
  function countTilesByName(tiles) {
    const counts = {};
    for (const tile of tiles || []) {
      counts[tile] = (counts[tile] || 0) + 1;
    }
    return counts;
  }
  function sanitizeTile(tile, state, context) {
    if (!tile) return null;
    try {
      return normalizeTile(tile);
    } catch {
      state.invalidTiles.push({ tile: String(tile), context });
      return null;
    }
  }
  function sanitizeTiles(tiles, state, context) {
    return (tiles || []).map((tile) => sanitizeTile(tile, state, context)).filter(Boolean);
  }
  function removeClaimedDiscard(state, meld, callerSeat) {
    const meldIndexes = new Set((meld || []).filter(Boolean).map(tileToIndex));
    for (let seat = 0; seat < state.discards.length; seat += 1) {
      if (seat === callerSeat) continue;
      const river = state.discards[seat];
      const lastTile = river[river.length - 1];
      if (lastTile && meldIndexes.has(tileToIndex(lastTile))) {
        river.pop();
        return lastTile;
      }
    }
    return null;
  }
  function removeOwnMeldTiles(state, meld, claimedTile) {
    const claimedIndex = claimedTile ? tileToIndex(claimedTile) : null;
    let skippedClaimed = false;
    const consumedIndexes = [];
    for (const tile of meld || []) {
      const index = tileToIndex(tile);
      if (!skippedClaimed && claimedIndex !== null && index === claimedIndex) {
        skippedClaimed = true;
        continue;
      }
      consumedIndexes.push(index);
    }
    for (const consumedIndex of consumedIndexes) {
      let removed = false;
      state.hand = state.hand.filter((tile) => {
        if (!removed && tileToIndex(tile) === consumedIndex) {
          removed = true;
          return false;
        }
        return true;
      });
    }
  }
  function removeOwnKnownTile(state, tile) {
    const targetIndex = tileToIndex(tile);
    if (state.drawnTile && tileToIndex(state.drawnTile) === targetIndex) {
      state.drawnTile = null;
      return;
    }
    let removed = false;
    state.hand = state.hand.filter((handTile) => {
      if (!removed && tileToIndex(handTile) === targetIndex) {
        removed = true;
        return false;
      }
      return true;
    });
  }
  function removeOwnKnownTiles(state, tiles = []) {
    for (const tile of tiles || []) {
      removeOwnKnownTile(state, tile);
    }
  }
  function buildWarnings(state) {
    const warnings = [];
    const handSize = state.hand.length + (state.drawnTile ? 1 : 0);
    if (handSize > 14) {
      warnings.push(`hand has ${handSize} tiles`);
    }
    if (state.drawnTile && !state.hand.length) {
      warnings.push("drawnTile exists without base hand");
    }
    for (const invalid of state.invalidTiles || []) {
      warnings.push(`ignored invalid tile ${invalid.tile} from ${invalid.context}`);
    }
    const knownTiles = [
      ...state.hand,
      state.drawnTile,
      ...state.visibleTiles
    ].filter(Boolean);
    const counts = tilesToCounts(knownTiles);
    counts.forEach((count, index) => {
      if (count > 4) {
        warnings.push(`${indexToTile(index)} appears ${count} times`);
      }
    });
    return warnings;
  }

  // src/core/shanten.js
  var TERMINAL_OR_HONOR = /* @__PURE__ */ new Set([0, 8, 9, 17, 18, 26, 27, 28, 29, 30, 31, 32, 33]);
  function cloneCounts(counts) {
    return counts.slice();
  }
  function isSuitSequenceStart(index) {
    return index < 27 && index % 9 <= 6;
  }
  function standardShantenFromCounts(counts, { openMelds = 0 } = {}) {
    let best = 8;
    const completedMelds = normalizeOpenMelds(openMelds);
    function scanMelds(work, start, melds) {
      while (start < 34 && work[start] === 0) start += 1;
      if (start >= 34) {
        scanTaatsu(work, 0, melds, 0);
        return;
      }
      if (work[start] >= 3) {
        work[start] -= 3;
        scanMelds(work, start, melds + 1);
        work[start] += 3;
      }
      if (isSuitSequenceStart(start) && work[start + 1] > 0 && work[start + 2] > 0) {
        work[start] -= 1;
        work[start + 1] -= 1;
        work[start + 2] -= 1;
        scanMelds(work, start, melds + 1);
        work[start] += 1;
        work[start + 1] += 1;
        work[start + 2] += 1;
      }
      scanMelds(work, start + 1, melds);
    }
    function scanTaatsu(work, start, melds, taatsu) {
      while (start < 34 && work[start] === 0) start += 1;
      if (start >= 34) {
        const totalMelds = melds + completedMelds;
        const usableTaatsu = Math.min(taatsu, 4 - totalMelds);
        best = Math.min(best, 8 - totalMelds * 2 - usableTaatsu);
        return;
      }
      if (work[start] >= 2) {
        work[start] -= 2;
        scanTaatsu(work, start, melds, taatsu + 1);
        work[start] += 2;
      }
      if (isSuitSequenceStart(start) && work[start + 1] > 0) {
        work[start] -= 1;
        work[start + 1] -= 1;
        scanTaatsu(work, start, melds, taatsu + 1);
        work[start] += 1;
        work[start + 1] += 1;
      }
      if (start < 27 && start % 9 <= 6 && work[start + 2] > 0) {
        work[start] -= 1;
        work[start + 2] -= 1;
        scanTaatsu(work, start, melds, taatsu + 1);
        work[start] += 1;
        work[start + 2] += 1;
      }
      scanTaatsu(work, start + 1, melds, taatsu);
    }
    scanMelds(cloneCounts(counts), 0, 0);
    for (let i = 0; i < 34; i += 1) {
      if (counts[i] >= 2) {
        const work = cloneCounts(counts);
        work[i] -= 2;
        let pairBest = 8;
        const oldBest = best;
        best = 8;
        scanMelds(work, 0, 0);
        pairBest = best - 1;
        best = Math.min(oldBest, pairBest);
      }
    }
    return best;
  }
  function normalizeOpenMelds(value) {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) return 0;
    return Math.min(4, Math.floor(number));
  }
  function chiitoiShantenFromCounts(counts) {
    let pairs = 0;
    let unique = 0;
    for (const count of counts) {
      if (count > 0) unique += 1;
      if (count >= 2) pairs += 1;
    }
    return 6 - pairs + Math.max(0, 7 - unique);
  }
  function kokushiShantenFromCounts(counts) {
    let unique = 0;
    let hasPair = false;
    for (const index of TERMINAL_OR_HONOR) {
      if (counts[index] > 0) unique += 1;
      if (counts[index] >= 2) hasPair = true;
    }
    return 13 - unique - (hasPair ? 1 : 0);
  }
  function calculateShanten(tilesOrCounts, { openMelds = 0 } = {}) {
    const counts = Array.isArray(tilesOrCounts) && tilesOrCounts.length === 34 && tilesOrCounts.every(Number.isInteger) ? tilesOrCounts : tilesToCounts(tilesOrCounts);
    const melds = normalizeOpenMelds(openMelds);
    if (melds > 0) {
      return standardShantenFromCounts(counts, { openMelds: melds });
    }
    return Math.min(
      standardShantenFromCounts(counts, { openMelds: melds }),
      chiitoiShantenFromCounts(counts),
      kokushiShantenFromCounts(counts)
    );
  }

  // src/core/ukeire.js
  function countVisibleTiles(tiles = []) {
    return tilesToCounts(tiles);
  }
  function findKnownTileLimitViolations(tiles = []) {
    return tilesToCounts(tiles).map((count, index) => ({ tile: indexToTile(index), count })).filter((entry) => entry.count > 4);
  }
  function assertKnownTileLimit(tiles = []) {
    const violations = findKnownTileLimitViolations(tiles);
    if (violations.length) {
      throw new Error(`Known tile count exceeds four: ${violations.map((entry) => `${entry.tile} x${entry.count}`).join(", ")}`);
    }
  }
  function calculateUkeire(handTiles, visibleTiles = [], { openMelds = 0 } = {}) {
    assertKnownTileLimit([...handTiles || [], ...visibleTiles || []]);
    const handCounts = tilesToCounts(handTiles);
    const visibleCounts = countVisibleTiles(visibleTiles);
    const baseShanten = calculateShanten(handCounts, { openMelds });
    const ukeireTiles = [];
    const ukeireBreakdown = [];
    let ukeireCount = 0;
    for (const tile of allTileTypes()) {
      const index = tileToIndex(tile);
      const remaining = Math.max(0, 4 - handCounts[index] - visibleCounts[index]);
      if (remaining === 0) continue;
      const nextCounts = handCounts.slice();
      nextCounts[index] += 1;
      if (calculateShanten(nextCounts, { openMelds }) < baseShanten) {
        const tile2 = indexToTile(index);
        ukeireTiles.push(tile2);
        ukeireBreakdown.push({ tile: tile2, remaining });
        ukeireCount += remaining;
      }
    }
    return {
      shanten: baseShanten,
      ukeireTiles,
      ukeireBreakdown,
      ukeireCount,
      ukeireTypes: ukeireTiles.length
    };
  }

  // src/core/analyzer.js
  function removeOneTile(tiles, discard) {
    const discardIndex = tileToIndex(discard);
    const result = [];
    let removed = false;
    for (const tile of tiles) {
      if (!removed && tileToIndex(tile) === discardIndex) {
        removed = true;
        continue;
      }
      result.push(tile);
    }
    return result;
  }
  function analyzeHand({ hand = [], drawnTile = null, visibleTiles = [], openMelds = 0 } = {}) {
    const combined = sortTiles(drawnTile ? [...hand, drawnTile] : hand);
    assertKnownTileLimit([...combined, ...visibleTiles || []]);
    const shanten = calculateShanten(combined, { openMelds });
    const canDiscard = combined.length % 3 === 2;
    if (!canDiscard) {
      return { hand: combined, openMelds, shanten, canDiscard, candidates: [] };
    }
    const counts = tilesToCounts(combined);
    const candidates = [];
    for (let index = 0; index < 34; index += 1) {
      if (counts[index] === 0) continue;
      const discard = indexToTile(index);
      const afterDiscard = removeOneTile(combined, discard);
      const discardVisible = [...visibleTiles, discard];
      const ukeire = calculateUkeire(afterDiscard, discardVisible, { openMelds });
      candidates.push({
        discard,
        shantenAfterDiscard: ukeire.shanten,
        ukeireTiles: ukeire.ukeireTiles,
        ukeireBreakdown: ukeire.ukeireBreakdown,
        ukeireCount: ukeire.ukeireCount,
        ukeireTypes: ukeire.ukeireTypes
      });
    }
    candidates.sort((a, b) => a.shantenAfterDiscard - b.shantenAfterDiscard || b.ukeireCount - a.ukeireCount || b.ukeireTypes - a.ukeireTypes || tileToIndex(a.discard) - tileToIndex(b.discard));
    return { hand: combined, openMelds, shanten, canDiscard, candidates };
  }

  // src/core/realPageReadiness.js
  var CAPTURE_VERIFICATION = Object.freeze({
    recommendedPath: "captures/capture-real.json",
    commands: Object.freeze({
      doctor: "npm run capture-doctor -- captures/capture-real.json",
      replay: "npm run replay -- captures/capture-real.json",
      realPageGate: "npm run real-page-gate"
    }),
    realPageReadyRequires: Object.freeze([
      "Mahjong Soul page metadata",
      "overlay live snapshots",
      "liveRealPagePreflight.readyToExport=true",
      "safe liveSafetySettings",
      "acceptance.readyForRealPageMvp=true",
      "liveStateSnapshotMatches=true"
    ])
  });
  var REAL_PAGE_PREFLIGHT_HINTS = Object.freeze({
    mahjongSoulPage: "Open Mahjong Soul web before exporting.",
    hookInstalled: "Reload the page after installing or updating the userscript.",
    captureRunning: "Click Resume before collecting live traffic.",
    liveSnapshotsIncluded: "Use Copy capture or Download capture from this overlay.",
    liveMvpGateReady: "Collect from round start until the MVP gate is complete.",
    eventBufferComplete: "Increase Capture limit, clear debug, and collect again from round start before exporting.",
    noTruncatedSamples: "Increase Binary sample bytes and collect a fresh sample before exporting.",
    noCaptureErrors: "Reload the page and collect again after capture errors stop appearing.",
    liveSafetySettingsIncluded: "Use the current overlay export so safety settings are included.",
    realtimeAdviceOff: "Turn realtime advice off before exporting an acceptance sample.",
    realtimeAdviceDefaultOff: "Reload the helper if realtime advice is no longer default-off.",
    manualInputInactive: "Clear Manual Input before exporting an acceptance sample.",
    automationDisabled: "Reload the helper if the no-automation boundary is not recorded.",
    clickAutomationDisabled: "Reload the helper if click automation is not recorded as disabled.",
    messageMutationDisabled: "Reload the helper if message mutation is not recorded as disabled."
  });
  var REQUIRED_REAL_PAGE_PREFLIGHT_CHECKS = Object.freeze(Object.keys(REAL_PAGE_PREFLIGHT_HINTS));
  var REAL_PAGE_PREFLIGHT_VERSION = 1;
  function isMahjongSoulPage(page) {
    const host = String(page?.host || "");
    const origin = String(page?.origin || "");
    const url = String(page?.sanitizedUrl || "");
    return /mahjongsoul|maj-soul/i.test(`${host} ${origin} ${url}`);
  }
  function buildLiveRealPagePreflight({ adapter, page, installDiagnostics, liveMvpGate, liveGameState, liveDebugSummary, liveSafetySettings }) {
    const droppedBeforeRetained = Number(installDiagnostics?.eventBuffer?.droppedBeforeRetained || 0);
    const checks = {
      mahjongSoulPage: isMahjongSoulPage(page),
      hookInstalled: Boolean(installDiagnostics?.installed ?? adapter?.installed),
      captureRunning: !(installDiagnostics?.paused || adapter?.paused),
      liveSnapshotsIncluded: Boolean(liveGameState && liveDebugSummary && liveMvpGate),
      liveMvpGateReady: liveMvpGate?.passed === liveMvpGate?.total,
      eventBufferComplete: droppedBeforeRetained === 0,
      noTruncatedSamples: Number(liveDebugSummary?.truncated || 0) === 0,
      noCaptureErrors: Number(liveDebugSummary?.captureErrors || 0) === 0,
      liveSafetySettingsIncluded: Boolean(liveSafetySettings && typeof liveSafetySettings === "object"),
      realtimeAdviceOff: liveSafetySettings?.realtimeAdviceEnabled === false,
      realtimeAdviceDefaultOff: liveSafetySettings?.realtimeAdviceDefault === false,
      manualInputInactive: liveSafetySettings?.manualInputActive === false,
      automationDisabled: liveSafetySettings?.automationDisabled === true,
      clickAutomationDisabled: liveSafetySettings?.clickAutomationDisabled === true,
      messageMutationDisabled: liveSafetySettings?.messageMutationDisabled === true
    };
    const entries = Object.entries(checks);
    const missing = entries.filter(([, value]) => !value).map(([key]) => key);
    const hints = missing.map((key) => REAL_PAGE_PREFLIGHT_HINTS[key]).filter(Boolean);
    return {
      preflightVersion: REAL_PAGE_PREFLIGHT_VERSION,
      requiredChecks: [...REQUIRED_REAL_PAGE_PREFLIGHT_CHECKS],
      checks,
      passed: entries.filter(([, value]) => value).length,
      total: entries.length,
      missing,
      hints,
      readyToExport: missing.length === 0,
      offlineValidationRequired: true,
      doctorCommand: CAPTURE_VERIFICATION.commands.doctor,
      offlineCommand: CAPTURE_VERIFICATION.commands.realPageGate
    };
  }

  // src/ui/styles.js
  var overlayStyles = `
#majsoul-helper-overlay {
  position: fixed;
  top: 96px;
  right: 16px;
  z-index: 2147483647;
  width: min(420px, calc(100vw - 24px));
  max-height: calc(100vh - 120px);
  color: #e8eaed;
  background: #202124;
  border: 1px solid #3c4043;
  border-radius: 8px;
  box-shadow: 0 18px 60px rgba(0, 0, 0, 0.35);
  font: 13px/1.45 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  overflow: hidden;
}
#majsoul-helper-overlay.mh-collapsed .mh-body { display: none; }
#majsoul-helper-overlay * { box-sizing: border-box; }
.mh-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 10px;
  cursor: move;
  background: #2b2c2f;
  border-bottom: 1px solid #3c4043;
  user-select: none;
}
.mh-title { font-weight: 650; }
.mh-actions { display: flex; gap: 6px; align-items: center; }
.mh-button {
  display: inline-block;
  border: 1px solid #5f6368;
  background: #303134;
  color: #e8eaed;
  border-radius: 6px;
  padding: 4px 8px;
  cursor: pointer;
  text-decoration: none;
}
.mh-button:hover { background: #3c4043; }
.mh-body {
  display: grid;
  gap: 10px;
  padding: 10px;
  overflow: auto;
  max-height: calc(100vh - 170px);
}
.mh-section {
  display: grid;
  gap: 6px;
}
.mh-section-title {
  color: #bdc1c6;
  font-size: 12px;
  font-weight: 650;
}
.mh-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}
.mh-tile {
  min-width: 26px;
  text-align: center;
  padding: 2px 5px;
  color: #202124;
  background: #f1f3f4;
  border-radius: 4px;
  font-weight: 650;
}
.mh-input {
  width: 100%;
  border: 1px solid #5f6368;
  border-radius: 6px;
  padding: 6px 8px;
  color: #e8eaed;
  background: #171717;
  user-select: text;
}
.mh-manual-input {
  flex: 1 1 220px;
  width: auto;
  min-width: 0;
}
.mh-warning {
  color: #fdd663;
  background: rgba(253, 214, 99, 0.12);
  border: 1px solid rgba(253, 214, 99, 0.35);
  padding: 6px 8px;
  border-radius: 6px;
}
.mh-candidate {
  display: grid;
  grid-template-columns: 48px 1fr;
  gap: 8px;
  padding: 6px 0;
  border-top: 1px solid #3c4043;
}
.mh-seat-grid {
  display: grid;
  gap: 8px;
}
.mh-seat {
  display: grid;
  gap: 4px;
  padding: 6px 0;
  border-top: 1px solid #3c4043;
}
.mh-seat-head {
  color: #e8eaed;
  font-weight: 650;
}
.mh-muted { color: #9aa0a6; }
.mh-code {
  width: 100%;
  min-height: 130px;
  white-space: pre-wrap;
  overflow: auto;
  padding: 8px;
  color: #d2e3fc;
  background: #171717;
  border: 1px solid #3c4043;
  border-radius: 6px;
}
`;

  // src/ui/overlay.js
  var STORAGE_KEY = "majsoul-helper-config";
  var OVERLAY_CAPTURE_NOTE = "Majsoul Helper capture export. Contains message summaries/samples plus liveGameState, liveDebugSummary, liveMvpGate, liveSafetySettings, and liveRealPagePreflight snapshots copied from the overlay; no messages were modified by the helper.";
  var DEFAULT_BINARY_SAMPLE_BYTES2 = 4096;
  var DEFAULT_CAPTURE_LIMIT = 3e3;
  var MAX_CAPTURE_LIMIT = 3e3;
  var OVERLAY_EVENT_SHIELD_TYPES = [
    "pointerdown",
    "pointerup",
    "pointermove",
    "mousedown",
    "mouseup",
    "click",
    "dblclick",
    "touchstart",
    "touchmove",
    "touchend",
    "wheel",
    "keydown",
    "keypress",
    "keyup",
    "beforeinput",
    "input",
    "change",
    "paste",
    "copy",
    "cut",
    "compositionstart",
    "compositionupdate",
    "compositionend"
  ];
  function escapeHtml(value) {
    return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
  }
  function renderTiles(tiles) {
    return (tiles || []).map((tile) => `<span class="mh-tile">${escapeHtml(tile)}</span>`).join("");
  }
  function renderDoraIndicators(indicators) {
    if (!indicators?.length) return "-";
    return indicators.map((indicator) => {
      try {
        return `${indicator}->${doraFromIndicator(indicator)}`;
      } catch {
        return `${indicator}->?`;
      }
    }).join(" ");
  }
  function renderCompactTileSummary(tiles = [], limit = 24) {
    if (!tiles?.length) return "0 tiles";
    const sorted = sortTiles(tiles);
    const shown = sorted.slice(0, limit);
    const hidden = Math.max(0, sorted.length - shown.length);
    return `${sorted.length} tiles ${renderTiles(shown)}${hidden ? ` <span class="mh-muted">+${hidden} more</span>` : ""}`;
  }
  function safeJson(value) {
    return JSON.stringify(value, null, 2);
  }
  function toCaptureStateSnapshot(state) {
    const { events, ...snapshot } = state || {};
    return snapshot;
  }
  function buildLiveSafetySettings({ realtimeAdvice, manualInput, installDiagnostics, adapter }) {
    return {
      realtimeAdviceEnabled: Boolean(realtimeAdvice),
      realtimeAdviceDefault: false,
      realtimeAdviceMode: realtimeAdvice ? "manual opt-in" : "off",
      manualInputActive: Boolean(String(manualInput || "").trim()),
      capturePaused: Boolean(installDiagnostics?.paused || adapter?.paused),
      automationDisabled: true,
      clickAutomationDisabled: true,
      messageMutationDisabled: true
    };
  }
  function getCurrentPageDiagnostics() {
    const location = globalThis.location;
    if (!location) {
      return {
        origin: "",
        host: "",
        pathname: "",
        sanitizedUrl: ""
      };
    }
    const origin = String(location.origin || "");
    const host = String(location.host || "");
    const pathname = String(location.pathname || "");
    return {
      origin,
      host,
      pathname,
      sanitizedUrl: `${origin}${pathname}`
    };
  }
  function readConfig() {
    try {
      return JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "{}");
    } catch {
      return {};
    }
  }
  function writeConfig(patch) {
    try {
      const next = { ...readConfig(), ...patch };
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
    }
  }
  function normalizeCaptureLimit(value, fallback = DEFAULT_CAPTURE_LIMIT) {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) return fallback;
    return Math.max(1, Math.min(MAX_CAPTURE_LIMIT, Math.floor(number)));
  }
  function normalizeBinarySampleBytes(value, fallback = DEFAULT_BINARY_SAMPLE_BYTES2) {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) return fallback;
    return Math.max(16, Math.min(4096, Math.floor(number)));
  }
  function renderSeatState(state) {
    return [0, 1, 2, 3].map((seat) => {
      const discards = state.discards?.[seat] || [];
      const melds = state.melds?.[seat] || [];
      const score = state.scores?.[seat] ?? "-";
      const riichi = state.riichi?.[seat] ? " riichi" : "";
      const turn = state.currentTurn === seat ? " turn" : "";
      const meldText = melds.length ? melds.map((meld) => (meld || []).join(" ")).join(" / ") : "-";
      return `
      <div class="mh-seat">
        <div class="mh-seat-head">Seat ${seat}${turn}${riichi} / ${escapeHtml(score)}</div>
        <div class="mh-muted">River</div>
        <div class="mh-row">${discards.length ? renderTiles(discards) : `<span class="mh-muted">-</span>`}</div>
        <div class="mh-muted">Melds: ${escapeHtml(meldText)}</div>
      </div>
    `;
    }).join("");
  }
  function summarizeDebugEvents(events) {
    const summary = {
      raw: 0,
      parsed: 0,
      captureErrors: 0,
      diagnostics: 0,
      truncated: 0,
      inbound: 0,
      outbound: 0,
      envelopes: 0,
      methods: 0,
      actions: 0,
      unparsedActions: {}
    };
    const methods = /* @__PURE__ */ new Set();
    const actions = /* @__PURE__ */ new Set();
    const rawActions = {};
    const parsedActions = {};
    for (const event of events || []) {
      if (event.type === "raw_message") {
        summary.raw += 1;
        if (event.source === "ws_in") summary.inbound += 1;
        if (event.source === "ws_out") summary.outbound += 1;
        if (event.payload?.truncated) summary.truncated += 1;
        const methodName = event.payload?.envelope?.methodName;
        const actionNames = envelopeActionNames2(event.payload?.envelope);
        if (event.payload?.envelope) summary.envelopes += 1;
        if (methodName) methods.add(methodName);
        for (const actionName of actionNames) {
          actions.add(actionName);
          rawActions[actionName] = (rawActions[actionName] || 0) + 1;
        }
      } else if (isStandardGameEvent(event.type)) {
        summary.parsed += 1;
        const methodName = event.payload?.binaryEnvelope?.methodName;
        const actionNames = [event.payload?.binaryEnvelope?.actionName].filter(Boolean);
        if (methodName) methods.add(methodName);
        for (const actionName of actionNames) {
          actions.add(actionName);
          parsedActions[actionName] = (parsedActions[actionName] || 0) + 1;
        }
      } else {
        summary.diagnostics += 1;
        if (event.type === "capture_error") summary.captureErrors += 1;
      }
    }
    summary.methods = methods.size;
    summary.actions = actions.size;
    for (const [actionName, count] of Object.entries(rawActions)) {
      const missing = count - (parsedActions[actionName] || 0);
      if (missing > 0) summary.unparsedActions[actionName] = missing;
    }
    return summary;
  }
  function envelopeActionNames2(envelope = {}) {
    return [
      envelope?.actionName,
      ...envelope?.restoreActionNames || []
    ].filter(Boolean);
  }
  function renderUnparsedActions(unparsedActions) {
    const entries = Object.entries(unparsedActions || {}).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    if (!entries.length) return "";
    return `<div class="mh-warning">Unparsed actions: ${escapeHtml(entries.map(([name, count]) => `${name} x${count}`).join(", "))}</div>`;
  }
  function summarizeActionDiagnostics(events) {
    const actions = /* @__PURE__ */ new Map();
    const parsedCounts = {};
    for (const event of events || []) {
      if (event.type === "raw_message") {
        const envelope = event.payload?.envelope;
        const actionNames = envelopeActionNames2(envelope);
        if (!actionNames.length) continue;
        for (const actionName of actionNames) {
          if (!actions.has(actionName)) {
            actions.set(actionName, {
              name: actionName,
              methodName: envelope.methodName,
              count: 0,
              parsedCount: 0,
              unparsedCount: 0,
              sample: {
                kind: event.payload?.kind || "unknown",
                messageLength: event.payload?.length ?? null,
                payloadLength: envelope.payloadLength ?? null,
                actionPayloadLength: envelope.actionPayloadLength ?? null,
                payloadTruncated: Boolean(event.payload?.truncated || envelope.payloadTruncated),
                actionPayloadTruncated: Boolean(envelope.actionPayloadTruncated),
                actionPayloadFields: envelope.actionPayloadFields || { varints: [], strings: [], tileStrings: [] }
              }
            });
          }
          actions.get(actionName).count += 1;
        }
        continue;
      }
      if (isStandardGameEvent(event.type)) {
        const actionName = event.payload?.binaryEnvelope?.actionName;
        if (actionName) parsedCounts[actionName] = (parsedCounts[actionName] || 0) + 1;
      }
    }
    return Array.from(actions.values()).map((entry) => ({
      ...entry,
      parsedCount: parsedCounts[entry.name] || 0,
      unparsedCount: Math.max(0, entry.count - (parsedCounts[entry.name] || 0))
    })).sort((a, b) => b.unparsedCount - a.unparsedCount || b.count - a.count || a.name.localeCompare(b.name)).slice(0, 8);
  }
  function formatFieldGroup(entries) {
    if (!entries?.length) return "-";
    return entries.map((entry) => `f${entry.field}:${(entry.values || []).join("/")}`).join(" ");
  }
  function formatActionFields(fields = {}) {
    return [
      `varints ${formatFieldGroup(fields.varints)}`,
      `tiles ${formatFieldGroup(fields.tileStrings)}`,
      `strings ${formatFieldGroup(fields.strings)}`
    ].join(" / ");
  }
  function renderActionDiagnostics(entries) {
    if (!entries.length) {
      return `<div class="mh-muted" data-role="action-diagnostics">Action diagnostics: -</div>`;
    }
    return `
    <div data-role="action-diagnostics">
      <div class="mh-muted">Action diagnostics</div>
      ${entries.map((entry) => {
      const sample = entry.sample || {};
      const truncated = sample.payloadTruncated || sample.actionPayloadTruncated ? " / truncated" : "";
      return `
          <div class="${entry.unparsedCount ? "mh-warning" : "mh-muted"}">
            ${escapeHtml(entry.name)} raw ${entry.count} / parsed ${entry.parsedCount} / unparsed ${entry.unparsedCount}${truncated}
            <br>sample ${escapeHtml(sample.kind || "unknown")} msg ${escapeHtml(sample.messageLength ?? "-")} / payload ${escapeHtml(sample.payloadLength ?? "-")} / action ${escapeHtml(sample.actionPayloadLength ?? "-")}
            <br>${escapeHtml(formatActionFields(sample.actionPayloadFields))}
          </div>
        `;
    }).join("")}
    </div>
  `;
  }
  function renderUkeireBreakdown(candidate) {
    const entries = candidate.ukeireBreakdown?.length ? candidate.ukeireBreakdown : (candidate.ukeireTiles || []).map((tile) => ({ tile, remaining: "?" }));
    if (!entries.length) return "-";
    return entries.map((entry) => `${entry.tile} x${entry.remaining}`).join(" ");
  }
  function formatHookDiagnostics(hooks = {}) {
    const constructorStatics = hooks.constructorStatics;
    const staticFailures = constructorStatics?.failed?.length || 0;
    const parts = [
      `constructor ${hooks.constructor ? "ok" : "off"}`,
      constructorStatics ? `statics ${constructorStatics.copied ?? 0} copied${staticFailures ? ` / ${staticFailures} failed` : ""}` : null,
      `prototype.constructor ${hooks.prototypeConstructor || "unknown"}`,
      `send ${hooks.send ? "ok" : "off"}`,
      `addEventListener ${hooks.addEventListener ? "ok" : "off"}`,
      `removeEventListener ${hooks.removeEventListener ? "ok" : "off"}`,
      `onmessage ${hooks.onmessage ? "ok" : "off"} (${hooks.onmessageMode || "unknown"})`,
      `client decode ${hooks.decodedMessage ? "ok" : "waiting"} (${hooks.decodedMessageMode || "unknown"})`,
      `page dispatch ${hooks.decodedDispatcher ? "ok" : "waiting"} (${hooks.decodedDispatcherMode || "unknown"})`
    ].filter(Boolean);
    return parts.join(" / ");
  }
  function formatRuntimeDiagnostics(runtime = {}) {
    const scriptName = runtime.unityBuildScript ? String(runtime.unityBuildScript).split("/").filter(Boolean).at(-1) : "";
    const instanceShape = formatRuntimeShapeSummary("instance", runtime.unityInstanceShape);
    const moduleShape = formatRuntimeShapeSummary("Module", runtime.unityModuleShape);
    const parts = [
      `Unity WebGL ${runtime.unityWebGL ? "detected" : "not detected"}`,
      scriptName ? `build ${scriptName}` : null,
      `loader observer ${runtime.createUnityInstanceLoadObserver ? "on" : "off"}`,
      `loader loads ${runtime.createUnityInstanceLoadEvents ?? 0}`,
      `createUnityInstance ${runtime.createUnityInstanceHook ? "hooked" : "waiting"} (${runtime.createUnityInstanceMode || "unknown"})`,
      `calls ${runtime.createUnityInstanceCalls ?? 0}`,
      `resolved ${runtime.createUnityInstanceResolved ? "yes" : "no"}`,
      `unityInstance ${runtime.hasUnityInstance ? "ok" : "missing"}`,
      `Module ${runtime.hasUnityModule ? "ok" : "missing"}`,
      `heap ${runtime.heapU8 ? "ok" : "missing"}`,
      instanceShape,
      moduleShape,
      `global net ${runtime.netMessageWrapperGlobal ? "ok" : "missing"}`,
      `global Laya ${runtime.layaGlobal ? "ok" : "missing"}`
    ].filter(Boolean);
    return parts.join(" / ");
  }
  function formatRuntimeShapeSummary(label, shape = {}) {
    if (!shape || typeof shape !== "object") return "";
    const keyCount = shape.keyCount ?? 0;
    const functionCount = shape.functionKeyCount ?? 0;
    const prototypeFunctionCount = shape.prototypeFunctionKeyCount ?? 0;
    if (!keyCount && !functionCount && !prototypeFunctionCount && !shape.unavailableReason) return "";
    const error = shape.unavailableReason ? ` / shape error ${shape.unavailableReason}` : "";
    return `${label} keys ${keyCount} / funcs ${functionCount} / proto funcs ${prototypeFunctionCount}${error}`;
  }
  function formatEventBufferDiagnostics(eventBuffer = {}) {
    if (!eventBuffer || typeof eventBuffer !== "object") return "Event buffer: unavailable";
    const retained = eventBuffer.retainedEvents ?? "-";
    const total = eventBuffer.totalEventsSinceClear ?? "-";
    const dropped = eventBuffer.droppedBeforeRetained ?? 0;
    const maxEvents = eventBuffer.maxEvents ?? "-";
    const oldest = eventBuffer.oldestEventId ?? "-";
    const newest = eventBuffer.newestEventId ?? "-";
    return `Event buffer: retained ${retained}/${total} / max ${maxEvents} / dropped ${dropped} / ids ${oldest}-${newest}`;
  }
  function stateHasTableData(state = {}) {
    return Boolean(
      state.hand?.length || state.drawnTile || state.discards?.some((tiles) => tiles.length) || state.melds?.some((melds) => melds.length) || state.doraIndicators?.length || state.visibleTiles?.length || state.chang !== null && state.chang !== void 0 || state.ju !== null && state.ju !== void 0 || state.round !== null && state.round !== void 0
    );
  }
  function captureHealth(adapter, summary, installDiagnostics = {}, state = {}) {
    if (adapter.paused) {
      return "Paused. Resume capture before sampling live traffic.";
    }
    if (!adapter.installed) {
      return "Hook not installed. Reload the page after installing the userscript.";
    }
    if (summary.raw === 0) {
      if (!installDiagnostics.socketsCreated) {
        return "Hook installed, but no WebSocket instance has been observed yet. Open or reload the game client.";
      }
      return "Waiting for WebSocket traffic. Join a table and watch for raw messages.";
    }
    if (summary.inbound === 0) {
      if (installDiagnostics.hooks?.onmessage === false && installDiagnostics.hooks?.onmessageMode === "non-configurable") {
        return "Only outbound traffic captured. The onmessage descriptor is non-configurable, so rely on addEventListener coverage and capture more traffic.";
      }
      return "Only outbound traffic captured. Wait for server messages or check message listener hook coverage.";
    }
    if (summary.envelopes === 0) {
      return "Inbound traffic captured, but no Liqi envelope decoded yet.";
    }
    if (summary.parsed === 0) {
      return "Liqi envelopes captured, but no standard game events parsed yet.";
    }
    if (!stateHasTableData(state)) {
      if (installDiagnostics.runtime?.unityWebGL) {
        return "Unity WebGL Action names are captured, but action payload fields are still encoded or unmapped. State restoration needs a Unity runtime hook or payload decoder.";
      }
      return "Standard game event names parsed, but no usable gameState fields updated yet. Inspect action payload field diagnostics.";
    }
    return "Standard game events parsed. Compare gameState with the visible table.";
  }
  function isValidSeat(seat) {
    const value = Number(seat);
    return Number.isInteger(value) && value >= 0 && value <= 3;
  }
  function isValidTile(tile) {
    try {
      normalizeTile(tile);
      return true;
    } catch {
      return false;
    }
  }
  function hasEventWithValidSeat(events, type) {
    return events.some((event) => event.type === type && isValidSeat(event.payload?.seat));
  }
  function hasOwnDrawTileWithValidTile(events) {
    return events.some((event) => event.type === "draw_tile" && Number(event.payload?.seat) === 0 && isValidTile(event.payload?.tile));
  }
  function stableJson(value) {
    return JSON.stringify(value);
  }
  function isChiPengGangAction2(actionName) {
    return actionName === "ActionChiPengGang" || actionName === "RecordChiPengGang";
  }
  function isAnGangAddGangAction2(actionName) {
    return actionName === "ActionAnGangAddGang" || actionName === "RecordAnGangAddGang";
  }
  function normalizeMeld2(meld) {
    if (!meld) return [];
    return Array.isArray(meld) ? meld : [meld];
  }
  function chronologicalEvents(events) {
    const entries = [...events || []];
    if (entries.every((event) => Number.isFinite(Number(event.ts)))) {
      return entries.sort((left, right) => Number(left.ts) - Number(right.ts));
    }
    return entries.reverse();
  }
  function removeLatestClaimedDiscard(discards, meld, callerSeat) {
    if (!isValidSeat(callerSeat) || !meld.length) return false;
    for (let seat = 0; seat < discards.length; seat += 1) {
      if (seat === callerSeat) continue;
      const river = discards[seat];
      const lastTile = river[river.length - 1];
      if (lastTile && meld.includes(lastTile)) {
        river.pop();
        return true;
      }
    }
    return false;
  }
  function discardsEqual(left, right) {
    return left.length === right.length && left.every((river, index) => river.length === (right[index] || []).length && river.every((tile, tileIndex) => tile === right[index][tileIndex]));
  }
  function buildClaimedDiscardDiagnostics(events, state) {
    const expectedDiscards = [[], [], [], []];
    const chiPengGangEvents = (events || []).filter((event) => isChiPengGangAction2(event.payload?.binaryEnvelope?.actionName));
    let claimableChiPengGangEvents = 0;
    for (const event of chronologicalEvents(events)) {
      if (event.type === "discard_tile" && isValidSeat(event.payload?.seat) && event.payload?.tile) {
        expectedDiscards[Number(event.payload.seat)].push(event.payload.tile);
      }
      if (isChiPengGangAction2(event.payload?.binaryEnvelope?.actionName)) {
        const removed = removeLatestClaimedDiscard(
          expectedDiscards,
          normalizeMeld2(event.payload?.meld),
          Number(event.payload?.seat)
        );
        if (removed) claimableChiPengGangEvents += 1;
      }
    }
    return {
      chiPengGangEvents: chiPengGangEvents.length,
      claimableChiPengGangEvents,
      claimedDiscardTransferred: chiPengGangEvents.length ? discardsEqual(expectedDiscards, state.discards || []) : null
    };
  }
  function buildKanDiagnostics(events, state) {
    const anGangAddGangEvents = (events || []).filter((event) => isAnGangAddGangAction2(event.payload?.binaryEnvelope?.actionName));
    const anGangAddGangEventsWithSeat = anGangAddGangEvents.filter((event) => isValidSeat(event.payload?.seat));
    const unknownKanTypeEvents = anGangAddGangEvents.filter((event) => {
      const type = Number(event.payload?.type);
      return type !== 2 && type !== 3;
    });
    const ownAnGangAddGangEvents = anGangAddGangEvents.filter((event) => Number(event.payload?.seat) === 0);
    const kanMeldMismatches = buildKanMeldMismatches(state, anGangAddGangEvents);
    const ownKanTilesStillInHand = buildOwnKanTilesStillInHand(state, ownAnGangAddGangEvents);
    return {
      anGangAddGangEvents: anGangAddGangEvents.length,
      anGangAddGangEventsWithSeat: anGangAddGangEventsWithSeat.length,
      unknownKanTypeEvents: unknownKanTypeEvents.length,
      ownAnGangAddGangEvents: ownAnGangAddGangEvents.length,
      kanTypeKnown: anGangAddGangEvents.length ? unknownKanTypeEvents.length === 0 : null,
      kanMeldTileCountsOk: anGangAddGangEvents.length ? kanMeldMismatches.length === 0 : null,
      ownKanTilesRemoved: ownAnGangAddGangEvents.length ? ownKanTilesStillInHand.length === 0 : null
    };
  }
  function buildKanMeldMismatches(state, events) {
    const mismatches = [];
    for (const event of events) {
      const seat = Number(event.payload?.seat);
      const tile = eventKanTile(event);
      const actualCopies = isValidSeat(seat) && tile ? maxMeldCopies(state, seat, tile) : 0;
      if (actualCopies < 4) {
        mismatches.push({ seat, tile, actualCopies });
      }
    }
    return mismatches;
  }
  function buildOwnKanTilesStillInHand(state, events) {
    const ownKnownTiles = [
      ...state.hand || [],
      state.drawnTile
    ].filter(Boolean).filter(isValidTile).map((tile) => normalizeTile(tile));
    const counts = {};
    for (const tile of ownKnownTiles) {
      counts[tile] = (counts[tile] || 0) + 1;
    }
    return events.map((event) => eventKanTile(event)).filter(Boolean).filter((tile, index, tiles) => tiles.indexOf(tile) === index).filter((tile) => counts[tile] > 0).map((tile) => ({ tile, count: counts[tile] }));
  }
  function eventKanTile(event) {
    const normalizedTiles = normalizeMeld2(event.payload?.meld).filter(isValidTile).map((tile) => normalizeTile(tile));
    return normalizedTiles[0] || null;
  }
  function maxMeldCopies(state, seat, tile) {
    let maxCopies = 0;
    for (const meld of state.melds?.[seat] || []) {
      const copies = normalizeMeld2(meld).filter(isValidTile).map((meldTile) => normalizeTile(meldTile)).filter((meldTile) => meldTile === tile).length;
      maxCopies = Math.max(maxCopies, copies);
    }
    return maxCopies;
  }
  function latestRoundEndScores(events) {
    const entries = chronologicalEvents(events);
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const event = entries[index];
      if (event.type === "round_end" && event.payload?.scores?.length) {
        return event.payload.scores;
      }
    }
    return null;
  }
  function inferExpectedCurrentTurn(events) {
    let expectedCurrentTurn = null;
    for (const event of chronologicalEvents(events)) {
      if (event.type === "round_start" && isValidSeat(event.payload?.currentTurn)) {
        expectedCurrentTurn = Number(event.payload.currentTurn);
      }
      if (event.type === "draw_tile" && isValidSeat(event.payload?.seat)) {
        expectedCurrentTurn = Number(event.payload.seat);
      }
      if (event.type === "discard_tile" && isValidSeat(event.payload?.seat)) {
        expectedCurrentTurn = null;
      }
      if (event.type === "call_meld" && isValidSeat(event.payload?.seat)) {
        expectedCurrentTurn = Number(event.payload.seat);
      }
      if (event.type === "round_end") {
        expectedCurrentTurn = null;
      }
    }
    return expectedCurrentTurn;
  }
  function buildLiveMvpGate(events, state, summary) {
    const eventTypes = events.map((event) => event.type);
    const rawEvents = events.filter((event) => event.type === "raw_message");
    const claimedDiscardDiagnostics = buildClaimedDiscardDiagnostics(events, state);
    const kanDiagnostics = buildKanDiagnostics(events, state);
    const expectedCurrentTurn = inferExpectedCurrentTurn(events);
    const checks = {
      rawMessagesCaptured: summary.raw > 0,
      inboundRawMessagesCaptured: summary.inbound > 0,
      binaryEnvelopeDecoded: summary.envelopes > 0,
      actionPrototypeDecoded: rawEvents.some((event) => envelopeActionNames2(event.payload?.envelope).length > 0),
      drawTileParsed: events.some((event) => event.type === "draw_tile"),
      drawTileSeatParsed: hasEventWithValidSeat(events, "draw_tile"),
      discardTileParsed: events.some((event) => event.type === "discard_tile"),
      discardTileSeatParsed: hasEventWithValidSeat(events, "discard_tile"),
      gameStateHandUpdated: Boolean(state.hand?.length),
      gameStateRoundMetadataUpdated: state.chang !== null || state.ju !== null || state.round !== null,
      gameStateDrawnTileUpdated: Boolean(state.drawnTile) || hasOwnDrawTileWithValidTile(events),
      gameStateDiscardsUpdated: Boolean(state.discards?.some((tiles) => tiles.length)),
      gameStateDoraIndicatorsUpdated: Boolean(state.doraIndicators?.length),
      gameStateScoresUpdated: Boolean(state.scoresKnown || state.scores?.some((score) => score !== 25e3)),
      gameStateVisibleTilesUpdated: Boolean(state.visibleTiles?.length),
      gameStateWarningsClear: !state.warnings?.length
    };
    if (eventTypes.includes("call_meld")) {
      checks.callMeldSeatParsed = hasEventWithValidSeat(events, "call_meld");
      checks.gameStateMeldsUpdated = Boolean(state.melds?.some((melds) => melds.length));
    }
    if (claimedDiscardDiagnostics.claimableChiPengGangEvents > 0) {
      checks.claimedDiscardTransferred = claimedDiscardDiagnostics.claimedDiscardTransferred === true;
    }
    if (kanDiagnostics.anGangAddGangEvents > 0) {
      checks.anGangAddGangSeatParsed = kanDiagnostics.anGangAddGangEventsWithSeat === kanDiagnostics.anGangAddGangEvents;
      checks.kanTypeKnown = kanDiagnostics.kanTypeKnown === true;
      checks.kanMeldTileCountsOk = kanDiagnostics.kanMeldTileCountsOk === true;
    }
    if (kanDiagnostics.ownAnGangAddGangEvents > 0) {
      checks.ownKanTilesRemoved = kanDiagnostics.ownKanTilesRemoved === true;
    }
    if (expectedCurrentTurn !== null) {
      checks.gameStateCurrentTurnUpdated = Number(state.currentTurn) === expectedCurrentTurn;
    }
    if (eventTypes.includes("riichi")) {
      checks.riichiSeatParsed = hasEventWithValidSeat(events, "riichi");
      checks.gameStateRiichiUpdated = Boolean(state.riichi?.some(Boolean));
    }
    if (eventTypes.includes("round_end")) {
      checks.roundEndReasonUpdated = state.roundEndReason !== null;
      const roundEndScores = latestRoundEndScores(events);
      if (roundEndScores) {
        checks.roundEndScoresUpdated = stableJson(state.scores) === stableJson(roundEndScores);
      }
    }
    const entries = Object.entries(checks);
    return {
      checks,
      passed: entries.filter(([, value]) => value).length,
      total: entries.length,
      missing: entries.filter(([, value]) => !value).map(([key]) => key)
    };
  }
  function renderLiveMvpGate(gate) {
    const ready = gate.passed === gate.total;
    const missing = gate.missing.length ? `Missing: ${gate.missing.join(", ")}` : "Ready for replay strict validation; compare against visible table.";
    return `
    <div class="${ready ? "mh-muted" : "mh-warning"}" data-role="mvp-gate">
      MVP gate: ${gate.passed}/${gate.total}. ${escapeHtml(missing)}
    </div>
  `;
  }
  function renderLiveRealPagePreflight(preflight) {
    const ready = preflight.readyToExport;
    const commandHint = `After export: run ${preflight.doctorCommand}, then ${preflight.offlineCommand} to confirm replay/liveStateSnapshotMatches.`;
    const message = ready ? `Ready to export. ${commandHint}` : `Missing before export: ${preflight.missing.join(", ")}. Next: ${preflight.hints.join(" ")} ${commandHint}`;
    return `
    <div class="${ready ? "mh-muted" : "mh-warning"}" data-role="real-page-preflight">
      Real-page preflight: ${preflight.passed}/${preflight.total}. ${escapeHtml(message)}
    </div>
  `;
  }
  function safeAnalyzeHand(input) {
    try {
      return { analysis: analyzeHand(input), error: "" };
    } catch (error) {
      return {
        analysis: null,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }
  var Overlay = class {
    constructor({ adapter, gameState }) {
      this.adapter = adapter;
      this.gameState = gameState;
      this.manualTiles = [];
      this.manualInput = "";
      this.manualError = "";
      this.realtimeAdvice = false;
      this.captureLimitDraft = null;
      this.binarySampleBytesDraft = null;
      const config = readConfig();
      const storedCaptureLimit = normalizeCaptureLimit(config.captureLimit ?? DEFAULT_CAPTURE_LIMIT, DEFAULT_CAPTURE_LIMIT);
      const adapterCaptureLimit = normalizeCaptureLimit(adapter.maxEvents ?? DEFAULT_CAPTURE_LIMIT, DEFAULT_CAPTURE_LIMIT);
      this.captureLimit = Math.max(DEFAULT_CAPTURE_LIMIT, storedCaptureLimit, adapterCaptureLimit);
      if (typeof adapter.setMaxEvents === "function") {
        this.captureLimit = adapter.setMaxEvents(this.captureLimit);
      }
      const storedBinarySampleBytes = normalizeBinarySampleBytes(config.binarySampleBytes ?? DEFAULT_BINARY_SAMPLE_BYTES2, DEFAULT_BINARY_SAMPLE_BYTES2);
      const adapterBinarySampleBytes = normalizeBinarySampleBytes(adapter.binarySampleBytes ?? DEFAULT_BINARY_SAMPLE_BYTES2, DEFAULT_BINARY_SAMPLE_BYTES2);
      this.binarySampleBytes = Math.max(DEFAULT_BINARY_SAMPLE_BYTES2, storedBinarySampleBytes, adapterBinarySampleBytes);
      if (typeof adapter.setBinarySampleBytes === "function") {
        this.binarySampleBytes = adapter.setBinarySampleBytes(this.binarySampleBytes);
      }
      if (config.captureLimit !== this.captureLimit || config.binarySampleBytes !== this.binarySampleBytes) {
        writeConfig({
          captureLimit: this.captureLimit,
          binarySampleBytes: this.binarySampleBytes
        });
      }
      this.copyError = "";
      this.copyFallbackText = "";
      this.downloadUrl = "";
      this.selfTestResult = null;
      this.root = null;
      this.overlayEventShieldBound = false;
    }
    mount() {
      if (this.root) return;
      const style = document.createElement("style");
      style.textContent = overlayStyles;
      document.documentElement.appendChild(style);
      this.root = document.createElement("div");
      this.root.id = "majsoul-helper-overlay";
      document.documentElement.appendChild(this.root);
      this.bindOverlayEventShield();
      this.bindAdapter();
      this.render();
    }
    bindOverlayEventShield() {
      if (this.overlayEventShieldBound || !this.root) return;
      const stopAtOverlay = (event) => {
        event.stopPropagation();
      };
      for (const type of OVERLAY_EVENT_SHIELD_TYPES) {
        this.root.addEventListener(type, stopAtOverlay);
      }
      this.overlayEventShieldBound = true;
    }
    bindAdapter() {
      this.adapter.addEventListener("majsoul-helper:event", (event) => {
        this.gameState.applyEvent(event.detail);
        this.render();
      });
      this.adapter.addEventListener("majsoul-helper:clear", () => {
        this.gameState.clearEvents();
        this.render();
      });
      this.adapter.addEventListener("majsoul-helper:install", () => {
        this.render();
      });
      this.adapter.addEventListener("majsoul-helper:config", () => {
        if (this.captureLimitDraft === null && Number.isFinite(this.adapter.maxEvents)) {
          this.captureLimit = this.adapter.maxEvents;
        }
        if (this.binarySampleBytesDraft === null) {
          this.binarySampleBytes = this.adapter.binarySampleBytes;
        }
        this.render();
      });
      this.adapter.addEventListener("majsoul-helper:socket", () => {
        this.render();
      });
      this.adapter.addEventListener("majsoul-helper:self-test", (event) => {
        this.selfTestResult = event.detail;
        this.render();
      });
    }
    render() {
      if (!this.root) return;
      const focusSnapshot = this.captureFocusSnapshot();
      const state = this.gameState.getVisibleState();
      const usingManualInput = this.manualInput.trim().length > 0;
      const hasValidManualTiles = usingManualInput && !this.manualError && this.manualTiles.length > 0;
      const handForAnalysis = usingManualInput ? this.manualTiles : state.hand;
      const drawnTileForAnalysis = usingManualInput ? null : state.drawnTile;
      const visibleTilesForAnalysis = usingManualInput ? [] : state.visibleTiles || [];
      const openMeldsForAnalysis = usingManualInput ? 0 : state.melds?.[0]?.length || 0;
      const shouldAnalyze = hasValidManualTiles || !usingManualInput && this.realtimeAdvice;
      const analysisResult = shouldAnalyze && handForAnalysis.length ? safeAnalyzeHand({ hand: handForAnalysis, drawnTile: drawnTileForAnalysis, visibleTiles: visibleTilesForAnalysis, openMelds: openMeldsForAnalysis }) : { analysis: null, error: "" };
      const analysis = analysisResult.analysis;
      const recentEvents = this.adapter.getRecentEvents();
      const debugSummary = summarizeDebugEvents(recentEvents);
      const actionDiagnostics = summarizeActionDiagnostics(recentEvents);
      const installDiagnostics = typeof this.adapter.getInstallDiagnostics === "function" ? this.adapter.getInstallDiagnostics() : { installed: this.adapter.installed, webSocketAvailable: typeof WebSocket !== "undefined" };
      const helperVersion = installDiagnostics.helperVersion || this.adapter.helperVersion || "";
      const liveMvpGate = buildLiveMvpGate(recentEvents, state, debugSummary);
      const liveSafetySettings = buildLiveSafetySettings({
        realtimeAdvice: this.realtimeAdvice,
        manualInput: this.manualInput,
        installDiagnostics,
        adapter: this.adapter
      });
      const liveRealPagePreflight = buildLiveRealPagePreflight({
        adapter: this.adapter,
        page: getCurrentPageDiagnostics(),
        installDiagnostics,
        liveMvpGate,
        liveGameState: toCaptureStateSnapshot(state),
        liveDebugSummary: debugSummary,
        liveSafetySettings
      });
      const captureLimitValue = this.captureLimitDraft ?? this.captureLimit;
      const binarySampleValue = this.binarySampleBytesDraft ?? this.binarySampleBytes ?? installDiagnostics.binarySampleBytes ?? DEFAULT_BINARY_SAMPLE_BYTES2;
      this.root.innerHTML = `
      <div class="mh-header">
        <div class="mh-title">Majsoul Helper${helperVersion ? ` <span class="mh-muted">v${escapeHtml(helperVersion)}</span>` : ""}</div>
        <div class="mh-actions">
          <button class="mh-button" data-action="toggle-capture">${this.adapter.paused ? "Resume" : "Pause"}</button>
          <button class="mh-button" data-action="collapse">Collapse</button>
        </div>
      </div>
      <div class="mh-body">
        <div class="mh-warning">Training/review use only. Realtime advice is off by default. No auto discard, no clicking, no message mutation.</div>
        <label class="mh-row">
          <input type="checkbox" data-action="realtime-advice" ${this.realtimeAdvice ? "checked" : ""}>
          <span>Enable realtime discard-candidate advice manually</span>
        </label>
        ${this.realtimeAdvice ? `<div class="mh-warning" data-role="realtime-risk">Risk feature active: realtime discard-candidate advice is for training/review only.</div>` : ""}
        <div class="mh-section">
          <div class="mh-section-title">Manual Input</div>
          <div class="mh-row">
            <input class="mh-input mh-manual-input" data-role="manual-input" placeholder="123m456p789s11z or 0m0p0s" value="${escapeHtml(this.manualInput || "")}">
            <button class="mh-button" data-action="clear-manual-input">Clear</button>
          </div>
          ${this.manualError ? `<div class="mh-warning">${escapeHtml(this.manualError)}</div>` : ""}
        </div>
        <div class="mh-section">
          <div class="mh-section-title">Current Hand</div>
          <div class="mh-muted" data-role="analysis-source">Analysis source: ${usingManualInput ? "manual input" : "captured state"}</div>
          <div class="mh-row" data-role="current-hand">${renderTiles(handForAnalysis)}</div>
          <div class="mh-muted" data-role="drawn-tile">Drawn tile: ${drawnTileForAnalysis ? renderTiles([drawnTileForAnalysis]) : "-"}</div>
          <div class="mh-muted">Open melds for analysis: ${escapeHtml(openMeldsForAnalysis)}</div>
          <div class="mh-muted">Dora indicators: ${escapeHtml(renderDoraIndicators(state.doraIndicators))}</div>
          <div class="mh-muted" data-role="visible-tiles-for-analysis">Visible known tiles for ukeire: ${usingManualInput ? "manual input ignores captured visible tiles" : renderCompactTileSummary(visibleTilesForAnalysis)}</div>
          <div class="mh-muted" data-role="round-metadata">Round: ${escapeHtml(state.round ?? "-")} / Chang ${escapeHtml(state.chang ?? "-")} / Ju ${escapeHtml(state.ju ?? "-")} / Round wind ${escapeHtml(state.roundWind ?? "-")} / Seat wind ${escapeHtml(state.seatWind ?? "-")}</div>
          <div class="mh-muted" data-role="counter-metadata">Honba ${escapeHtml(state.honba ?? "-")} / Riichi sticks ${escapeHtml(state.riichiSticks ?? "-")}</div>
          <div class="mh-muted" data-role="turn-metadata">Turn: ${escapeHtml(state.currentTurn ?? "-")} / Wall: ${escapeHtml(state.leftTileCount ?? "-")} / Step: ${escapeHtml(state.lastStep ?? "-")}</div>
          <div class="mh-muted" data-role="riichi-round-end">Riichi: ${escapeHtml(state.riichi.map((value, index) => value ? index : null).filter((value) => value !== null).join(" ") || "-")} / End: ${escapeHtml(state.roundEndReason ?? "-")}</div>
          ${state.warnings?.length ? `<div class="mh-warning">State warnings: ${escapeHtml(state.warnings.join("; "))}</div>` : ""}
        </div>
        <div class="mh-section">
          <div class="mh-section-title">Table State</div>
          <div class="mh-seat-grid">${renderSeatState(state)}</div>
        </div>
        <div class="mh-section">
          <div class="mh-section-title">Analysis</div>
          ${analysis ? this.renderAnalysis(analysis) : this.renderAnalysisPlaceholder(usingManualInput, analysisResult.error)}
        </div>
        <div class="mh-section">
          <div class="mh-section-title">Debug</div>
          <div class="mh-row">
            <button class="mh-button" data-action="copy-state">Copy gameState</button>
            <button class="mh-button" data-action="copy-capture">Copy capture</button>
            <a class="mh-button" data-action="download-capture" href="#" download="majsoul-helper-capture.json">Download capture</a>
            <button class="mh-button" data-action="clear-debug">Clear debug</button>
            <button class="mh-button" data-action="self-test">Self-test</button>
          </div>
          ${this.selfTestResult ? this.renderSelfTest(this.selfTestResult) : ""}
          <label class="mh-muted">Capture limit <input class="mh-input" data-role="capture-limit" type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="off" spellcheck="false" aria-label="Capture limit, 1 to 3000" value="${escapeHtml(captureLimitValue)}"></label>
          <label class="mh-muted">Binary sample bytes <input class="mh-input" data-role="binary-sample-bytes" type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="off" spellcheck="false" aria-label="Binary sample bytes, 16 to 4096" value="${escapeHtml(binarySampleValue)}"></label>
          <div class="mh-muted" data-role="install-diagnostics">Install: ${installDiagnostics.installed ? "installed" : "not installed"}${helperVersion ? ` / v${escapeHtml(helperVersion)}` : ""} / capture ${installDiagnostics.paused || this.adapter.paused ? "paused" : "running"} / attempts ${escapeHtml(installDiagnostics.installAttempts ?? "-")} / WebSocket ${installDiagnostics.webSocketAvailable ? "available" : "missing"} / sockets ${escapeHtml(installDiagnostics.socketsCreated ?? 0)} / sample ${escapeHtml(installDiagnostics.binarySampleBytes ?? "-")} bytes / client decode ${installDiagnostics.hooks?.decodedMessage ? "hooked" : "waiting"} / page dispatch ${installDiagnostics.hooks?.decodedDispatcher ? "hooked" : "waiting"}</div>
          <div class="mh-muted" data-role="hook-diagnostics">Hooks: ${escapeHtml(formatHookDiagnostics(installDiagnostics.hooks))}</div>
          <div class="mh-muted" data-role="runtime-diagnostics">Runtime: ${escapeHtml(formatRuntimeDiagnostics(installDiagnostics.runtime))}</div>
          <div class="${Number(installDiagnostics.eventBuffer?.droppedBeforeRetained || 0) > 0 ? "mh-warning" : "mh-muted"}" data-role="event-buffer-diagnostics">${escapeHtml(formatEventBufferDiagnostics(installDiagnostics.eventBuffer))}</div>
          ${installDiagnostics.recentSocketUrls?.length ? `<div class="mh-muted">Recent sockets: ${escapeHtml(installDiagnostics.recentSocketUrls.join(" / "))}</div>` : ""}
          ${installDiagnostics.installFailureReason ? `<div class="mh-warning">${escapeHtml(installDiagnostics.installFailureReason)}</div>` : ""}
          <div class="mh-muted" data-role="capture-health">Capture health: ${escapeHtml(captureHealth(this.adapter, debugSummary, installDiagnostics, state))}</div>
          ${renderLiveMvpGate(liveMvpGate)}
          ${renderLiveRealPagePreflight(liveRealPagePreflight)}
          <div class="mh-muted">Capture summary: raw ${debugSummary.raw} / inbound ${debugSummary.inbound} / outbound ${debugSummary.outbound} / parsed ${debugSummary.parsed} / errors ${debugSummary.captureErrors} / diagnostics ${debugSummary.diagnostics} / envelopes ${debugSummary.envelopes} / truncated ${debugSummary.truncated} / methods ${debugSummary.methods} / actions ${debugSummary.actions}</div>
          ${debugSummary.truncated ? `<div class="mh-warning">Some captured samples are truncated. Increase capture quality by replaying diagnostics before mapping fields.</div>` : ""}
          ${renderUnparsedActions(debugSummary.unparsedActions)}
          ${renderActionDiagnostics(actionDiagnostics)}
          <div class="mh-muted">Recent messages</div>
          ${this.copyError ? `<div class="mh-warning">${escapeHtml(this.copyError)}</div><textarea class="mh-input" data-role="copy-fallback" rows="5">${escapeHtml(this.copyFallbackText)}</textarea>` : ""}
          <pre class="mh-code">${escapeHtml(safeJson(recentEvents.slice(0, 8)))}</pre>
          <div class="mh-muted">gameState</div>
          <pre class="mh-code">${escapeHtml(safeJson(state))}</pre>
        </div>
      </div>
    `;
      this.bindDomEvents();
      this.restoreFocus(focusSnapshot);
    }
    renderAnalysis(analysis) {
      return `
      <div>Current shanten: <strong>${analysis.shanten}</strong></div>
      ${analysis.canDiscard ? `
        <div>
          ${analysis.candidates.map((candidate) => `
            <div class="mh-candidate">
              <div>${renderTiles([candidate.discard])}</div>
              <div>
                <div>After discard shanten: ${candidate.shantenAfterDiscard}</div>
                <div>Ukeire: ${escapeHtml(renderUkeireBreakdown(candidate))} (${candidate.ukeireTypes} types / ${candidate.ukeireCount} tiles)</div>
              </div>
            </div>
          `).join("")}
        </div>
      ` : `
        <div class="mh-muted">Discard candidates are shown only with 3n+2 tiles. Wait for a draw or enter a complete 14-tile hand.</div>
      `}
    `;
    }
    renderAnalysisPlaceholder(usingManualInput, error = "") {
      const message = error ? `Analysis failed: ${error}` : usingManualInput ? "Fix manual input to show analysis." : "Enter a hand or enable realtime advice to show analysis.";
      return `<div class="${error ? "mh-warning" : "mh-muted"}">${escapeHtml(message)}</div>`;
    }
    renderSelfTest(result) {
      return `
      <div class="${result.ok ? "mh-muted" : "mh-warning"}" data-role="self-test-result">
        Self-test: ${result.ok ? "ok" : "failed"} /
        install ${result.installed ? "installed" : "not installed"} /
        WebSocket ${result.webSocketAvailable ? "available" : "missing"} /
        readable ${escapeHtml(result.readableParsedTypes.join(",") || "-")} /
        binary ${escapeHtml(result.binaryEnvelope?.actionName || "-")} -> ${escapeHtml(result.binaryParsedTypes.join(",") || "-")}
      </div>
    `;
    }
    bindDomEvents() {
      this.root.querySelector('[data-action="collapse"]').onclick = () => {
        this.root.classList.toggle("mh-collapsed");
      };
      this.root.querySelector('[data-action="toggle-capture"]').onclick = () => {
        this.adapter.setPaused(!this.adapter.paused);
        this.render();
      };
      this.root.querySelector('[data-action="realtime-advice"]').onchange = (event) => {
        this.realtimeAdvice = event.target.checked;
        this.render();
      };
      this.root.querySelector('[data-action="copy-state"]').onclick = async () => {
        await this.copyText(safeJson(this.gameState.getVisibleState()));
      };
      this.root.querySelector('[data-action="copy-capture"]').onclick = async () => {
        await this.copyText(safeJson(this.buildOverlayCapture()));
      };
      this.root.querySelector('[data-action="download-capture"]').onclick = (event) => {
        if (!this.prepareCaptureDownload(event.currentTarget)) event.preventDefault();
      };
      this.root.querySelector('[data-action="clear-debug"]').onclick = () => {
        this.adapter.clearEvents();
      };
      this.root.querySelector('[data-action="self-test"]').onclick = () => {
        if (typeof this.adapter.runSelfTest === "function") {
          this.selfTestResult = this.adapter.runSelfTest();
        } else {
          this.selfTestResult = {
            ok: false,
            installed: this.adapter.installed,
            webSocketAvailable: typeof WebSocket !== "undefined",
            readableParsedTypes: [],
            binaryEnvelope: null,
            binaryParsedTypes: []
          };
          this.render();
        }
      };
      this.bindNumericInput(this.root.querySelector('[data-role="capture-limit"]'), {
        setDraft: (value) => {
          this.captureLimitDraft = value;
        },
        commit: (value) => this.commitCaptureLimit(value),
        reset: () => {
          this.captureLimitDraft = null;
          this.render();
        }
      });
      this.bindNumericInput(this.root.querySelector('[data-role="binary-sample-bytes"]'), {
        setDraft: (value) => {
          this.binarySampleBytesDraft = value;
        },
        commit: (value) => this.commitBinarySampleBytes(value),
        reset: () => {
          this.binarySampleBytesDraft = null;
          this.render();
        }
      });
      const manualInput = this.root.querySelector('[data-role="manual-input"]');
      manualInput.oninput = (event) => {
        this.updateManualInput(event.target.value, {
          refocus: true,
          selectionStart: event.target.selectionStart,
          selectionEnd: event.target.selectionEnd
        });
      };
      manualInput.onchange = (event) => {
        if (event.target.value !== this.manualInput) {
          this.updateManualInput(event.target.value);
        }
      };
      this.root.querySelector('[data-action="clear-manual-input"]').onclick = () => {
        this.updateManualInput("", { refocus: true });
      };
      this.enableDrag();
    }
    bindNumericInput(input, { setDraft, commit, reset }) {
      input.oninput = (event) => {
        event.stopPropagation();
        setDraft(event.target.value.replace(/[^\d]/g, ""));
        if (event.target.value !== event.target.value.replace(/[^\d]/g, "")) {
          event.target.value = event.target.value.replace(/[^\d]/g, "");
        }
      };
      input.onchange = (event) => {
        event.stopPropagation();
        commit(event.target.value);
      };
      input.onblur = (event) => {
        commit(event.target.value);
      };
      input.onkeydown = (event) => {
        event.stopPropagation();
        if (event.key === "Enter") {
          event.preventDefault();
          commit(event.currentTarget.value);
          event.currentTarget.blur();
        }
        if (event.key === "Escape") {
          event.preventDefault();
          reset();
        }
      };
    }
    commitCaptureLimit(value) {
      const nextValue = normalizeCaptureLimit(value, this.captureLimit);
      this.captureLimitDraft = null;
      this.captureLimit = nextValue;
      if (typeof this.adapter.setMaxEvents === "function") {
        this.captureLimit = this.adapter.setMaxEvents(nextValue);
      }
      writeConfig({ captureLimit: this.captureLimit });
      this.render();
    }
    commitBinarySampleBytes(value) {
      const nextValue = normalizeBinarySampleBytes(value, this.binarySampleBytes ?? DEFAULT_BINARY_SAMPLE_BYTES2);
      this.binarySampleBytesDraft = null;
      if (typeof this.adapter.setBinarySampleBytes === "function") {
        this.binarySampleBytes = this.adapter.setBinarySampleBytes(nextValue);
      } else {
        this.binarySampleBytes = nextValue;
      }
      writeConfig({ binarySampleBytes: this.binarySampleBytes });
      this.render();
    }
    captureFocusSnapshot() {
      const active = document.activeElement;
      if (!active || !this.root.contains(active)) return null;
      const role = active.getAttribute("data-role");
      if (!role) return null;
      return {
        role,
        selectionStart: typeof active.selectionStart === "number" ? active.selectionStart : null,
        selectionEnd: typeof active.selectionEnd === "number" ? active.selectionEnd : null
      };
    }
    restoreFocus(snapshot) {
      if (!snapshot?.role) return;
      const input = this.root.querySelector(`[data-role="${snapshot.role}"]`);
      if (!input || typeof input.focus !== "function") return;
      input.focus({ preventScroll: true });
      if (typeof input.setSelectionRange === "function" && snapshot.selectionStart !== null) {
        const length = String(input.value || "").length;
        const start = Math.min(snapshot.selectionStart, length);
        const end = Math.min(snapshot.selectionEnd ?? start, length);
        input.setSelectionRange(start, end);
      }
    }
    updateManualInput(value, { refocus = false, selectionStart = null, selectionEnd = null } = {}) {
      this.manualInput = value;
      try {
        this.manualTiles = parseTiles(value);
        this.manualError = "";
      } catch (error) {
        this.manualTiles = [];
        this.manualError = error.message;
      }
      this.render();
      if (!refocus) return;
      const input = this.root?.querySelector('[data-role="manual-input"]');
      if (!input) return;
      input.focus();
      if (typeof input.setSelectionRange === "function") {
        const start = Math.min(selectionStart ?? value.length, value.length);
        const end = Math.min(selectionEnd ?? start, value.length);
        input.setSelectionRange(start, end);
      }
    }
    async copyText(text) {
      try {
        await navigator.clipboard.writeText(text);
        this.copyError = "";
        this.copyFallbackText = "";
      } catch (error) {
        this.copyError = "Clipboard write failed. Select and copy the text below.";
        this.copyFallbackText = text;
      }
      this.render();
      const fallback = this.root.querySelector('[data-role="copy-fallback"]');
      if (fallback) {
        fallback.focus();
        fallback.select();
      }
    }
    buildOverlayCapture() {
      const capture = this.adapter.exportCapture({ limit: this.captureLimit });
      const recentEvents = this.adapter.getRecentEvents().slice(0, this.captureLimit);
      const liveGameState = toCaptureStateSnapshot(this.gameState.getVisibleState());
      const liveDebugSummary = summarizeDebugEvents(recentEvents);
      const installDiagnostics = capture.helperDiagnostics || (typeof this.adapter.getInstallDiagnostics === "function" ? this.adapter.getInstallDiagnostics({ events: recentEvents }) : {});
      const liveMvpGate = buildLiveMvpGate(recentEvents, liveGameState, liveDebugSummary);
      const liveSafetySettings = buildLiveSafetySettings({
        realtimeAdvice: this.realtimeAdvice,
        manualInput: this.manualInput,
        installDiagnostics,
        adapter: this.adapter
      });
      return {
        ...capture,
        note: OVERLAY_CAPTURE_NOTE,
        verification: CAPTURE_VERIFICATION,
        liveGameState,
        liveDebugSummary,
        liveMvpGate,
        liveSafetySettings,
        liveRealPagePreflight: buildLiveRealPagePreflight({
          adapter: this.adapter,
          page: capture.page || getCurrentPageDiagnostics(),
          installDiagnostics,
          liveMvpGate,
          liveGameState,
          liveDebugSummary,
          liveSafetySettings
        }),
        liveCaptureHealth: captureHealth(this.adapter, liveDebugSummary, installDiagnostics, liveGameState)
      };
    }
    prepareCaptureDownload(link) {
      const text = safeJson(this.buildOverlayCapture());
      if (typeof Blob === "undefined" || !globalThis.URL?.createObjectURL) {
        this.copyError = "Capture download is unavailable in this browser context. Select and copy the text below.";
        this.copyFallbackText = text;
        this.render();
        return false;
      }
      if (this.downloadUrl && globalThis.URL?.revokeObjectURL) {
        globalThis.URL.revokeObjectURL(this.downloadUrl);
      }
      const blob = new Blob([text], { type: "application/json" });
      this.downloadUrl = globalThis.URL.createObjectURL(blob);
      link.href = this.downloadUrl;
      link.download = `majsoul-helper-capture-${(/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-")}.json`;
      this.copyError = "";
      this.copyFallbackText = "";
      return true;
    }
    enableDrag() {
      const header = this.root.querySelector(".mh-header");
      let start = null;
      header.onpointerdown = (event) => {
        if (event.target.closest("button")) return;
        start = {
          pointerId: event.pointerId,
          x: event.clientX,
          y: event.clientY,
          left: this.root.offsetLeft,
          top: this.root.offsetTop
        };
        header.setPointerCapture(event.pointerId);
      };
      header.onpointermove = (event) => {
        if (!start || event.pointerId !== start.pointerId) return;
        const left = Math.max(0, Math.min(window.innerWidth - this.root.offsetWidth, start.left + event.clientX - start.x));
        const top = Math.max(0, Math.min(window.innerHeight - 48, start.top + event.clientY - start.y));
        this.root.style.left = `${left}px`;
        this.root.style.right = "auto";
        this.root.style.top = `${top}px`;
      };
      header.onpointerup = () => {
        start = null;
      };
    }
  };

  // src/main.js
  var STORAGE_KEY2 = "majsoul-helper-config";
  var HELPER_VERSION = "0.2.8";
  function upgradedStoredNumber(value, fallback) {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) return fallback;
    return Math.max(fallback, Math.floor(number));
  }
  function readConfig2() {
    try {
      return JSON.parse(window.localStorage.getItem(STORAGE_KEY2) || "{}");
    } catch {
      return {};
    }
  }
  function boot() {
    const existingHelper = window.__majsoulHelper;
    if (existingHelper?.version === HELPER_VERSION) return existingHelper;
    if (existingHelper?.version) {
      try {
        existingHelper.adapter?.uninstall?.();
      } catch {
      }
      try {
        existingHelper.overlay?.root?.remove?.();
        document.getElementById("majsoul-helper-overlay")?.remove?.();
      } catch {
      }
    }
    const config = readConfig2();
    const adapter = new MajsoulAdapter({
      helperVersion: HELPER_VERSION,
      binarySampleBytes: upgradedStoredNumber(config.binarySampleBytes, DEFAULT_BINARY_SAMPLE_BYTES),
      maxEvents: upgradedStoredNumber(config.captureLimit, DEFAULT_MAX_EVENTS)
    });
    const gameState = new GameState();
    const helper = {
      version: HELPER_VERSION,
      adapter,
      gameState,
      overlay: null,
      analyzeHand,
      parseTiles
    };
    window.__majsoulHelper = helper;
    let retryTimer = null;
    const tryInstall = () => {
      if (adapter.install() && retryTimer !== null) {
        window.clearInterval(retryTimer);
        retryTimer = null;
      }
    };
    tryInstall();
    if (!adapter.installed && typeof window !== "undefined") {
      retryTimer = window.setInterval(tryInstall, 250);
    }
    const mountOverlay = () => {
      if (helper.overlay?.root) return helper.overlay;
      const overlay = new Overlay({ adapter, gameState });
      overlay.mount();
      helper.overlay = overlay;
      return overlay;
    };
    if (document.documentElement) {
      mountOverlay();
    } else {
      document.addEventListener("DOMContentLoaded", mountOverlay, { once: true });
    }
    return helper;
  }
  boot();
})();
