const BINARY_ENVELOPE_SAMPLE_BYTES = 512;

function readPath(value, path) {
  let current = value;
  for (const part of path) {
    if (current == null || typeof current !== "object" || !(part in current)) return undefined;
    current = current[part];
  }
  return current;
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null);
}

function definedObject(values) {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined));
}

function toArray(value, fallback = []) {
  if (value === undefined || value === null) return fallback;
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
    Array.isArray(dora) ? undefined : dora
  );
}

function readableScores(payload = {}) {
  const scores = firstDefined(payload.scores, payload.points, payload.finalScores, payload.score);
  if (scores === undefined) return undefined;
  return toArray(scores).map((score) => {
    const number = Number(score);
    return Number.isFinite(number) ? number : score;
  });
}

function readableRoundEndReason(payload = {}, sourceName = "") {
  const explicit = firstDefined(payload.reason, payload.roundEndReason, payload.endReason);
  if (explicit !== undefined) return explicit;
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
  if (depth > 3 || value === undefined || value === null) return undefined;
  if (typeof value === "string") return value;
  if (typeof value !== "object") return undefined;

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
  return /^(Action|Record)[A-Za-z0-9_]+$/.test(constructorName) ? constructorName : undefined;
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
    actionName
    && outerPayload
    && typeof outerPayload === "object"
    && outerPayload !== message
    && ("data" in outerPayload || "payload" in outerPayload || "result" in outerPayload)
  );
  const name = (isActionPrototypeName(outerName) || hasNestedActionPayload) ? actionName : outerName;
  if (!name) return null;
  const payload = hasNestedActionPayload || isActionPrototypeName(outerName)
    ? decodedPayloadOf(outerPayload)
    : outerPayload;
  const methodName = isActionPrototypeName(outerName)
    ? ".lq.ActionPrototype"
    : outerName;

  return {
    name,
    payload: payload && typeof payload === "object" ? payload : {},
    methodName,
    actionName: /^(Action|Record)[A-Za-z0-9_]+$/.test(String(name)) ? String(name) : undefined,
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
      chang !== undefined && ju !== undefined ? `${chang}-${ju}` : undefined,
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
      ...(riichi ? { riichi } : {})
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
      ...(riichi ? { riichi } : {})
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
  if (!value || typeof value !== "object") return undefined;
  const riichi = definedObject({
    seat: firstDefined(value.seat, value.seat_id, value.who, value.actor),
    score: firstDefined(value.score, value.points),
    riichiSticks: firstDefined(value.riichiSticks, value.lizhibang, value.liqibang)
  });
  return Object.keys(riichi).length ? riichi : undefined;
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
  const grouped = new Map();
  for (const entry of entries) {
    const value = mapValue(entry);
    if (value === undefined || value === null || value === "") continue;
    if (!grouped.has(entry.field)) grouped.set(entry.field, []);
    const values = grouped.get(entry.field);
    if (values.length < 12) values.push(value);
  }
  return Array.from(grouped.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([field, values]) => ({ field, values }));
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
    strings: groupValuesByField(fields.lengthDelimited, (entry) => (
      isPrintableShortText(entry.text) ? entry.text : undefined
    )),
    tileStrings: groupValuesByField(fields.lengthDelimited, (entry) => (
      tileLike(entry.text) ? entry.text : undefined
    ))
  };
}

function decodeVarint(bytes, offset) {
  let value = 0;
  let multiplier = 1;
  let cursor = offset;
  while (cursor < bytes.length && cursor - offset < 10) {
    const byte = bytes[cursor];
    value += (byte & 0x7f) * multiplier;
    if (!Number.isSafeInteger(value)) return null;
    cursor += 1;
    if ((byte & 0x80) === 0) return { value, offset: cursor };
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
    const wireType = tag.value & 0x07;

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

  const methodEntry = lengthDelimited.find((entry) => /^\.?lq\./.test(entry.text))
    || lengthDelimited.find((entry) => /Action|Req|Res|Notify|Lobby/.test(entry.text));
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

function varintField(fields, id) {
  return fields.varints.find((entry) => entry.field === id)?.value;
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
  return fields.lengthDelimited
    .filter((entry) => entry.field === id)
    .flatMap((entry) => decodeVarintSequence(entry.bytes));
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
  const seat = bytes[1] ^ 0x7e;
  const tile = String.fromCharCode(bytes[4] ^ 0x66, bytes[5] ^ 0xd4);
  const tsumogiri = bytes[9] ^ 0xca;

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
  return fields.lengthDelimited
    .filter((entry) => entry.field === id && entry.bytes?.length)
    .map((entry) => parseProtobufEnvelope(entry.bytes).fields);
}

function nestedPayloadEntries(fields, id) {
  return fields.lengthDelimited.filter((entry) => entry.field === id && entry.bytes?.length);
}

function decodeLiQiSuccess(fields, id = 5) {
  const liqiFields = nestedPayloadFields(fields, id)[0];
  if (!liqiFields) return undefined;
  const riichi = definedObject({
    seat: numericField(liqiFields, 1),
    score: numericField(liqiFields, 2),
    riichiSticks: numericField(liqiFields, 3)
  });
  return Object.keys(riichi).length ? riichi : undefined;
}

function decodeGameEndScores(fields, id) {
  const gameEnd = nestedPayloadFields(fields, id)[0];
  return gameEnd ? numericFields(gameEnd, 1) : [];
}

function denseScoreArray(scores) {
  if (!scores.length) return false;
  for (let index = 0; index < scores.length; index += 1) {
    if (scores[index] === undefined) return false;
  }
  return true;
}

function decodeNoTileScoreInfos(fields) {
  const scoreInfos = nestedPayloadFields(fields, 3);
  const orderedScores = [];
  const scoresBySeat = [];

  for (const scoreFields of scoreInfos) {
    const score = numericField(scoreFields, 7);
    if (score !== undefined) orderedScores.push(score);

    const seat = numericField(scoreFields, 1);
    if (seat !== undefined && score !== undefined) {
      scoresBySeat[seat] = score;
    }
  }

  const doraIndicators = scoreInfos
    .map((scoreFields) => tileStringFields(scoreFields, 6))
    .find((tiles) => tiles.length) || [];

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
    if (score !== undefined) scores[seat] = score;
    const riichiPosition = numericField(playerFields, 2);
    if (riichiPosition !== undefined && riichiPosition > 0) riichi[seat] = true;
    discards[seat] = tileStringFields(playerFields, 4);
    melds[seat] = nestedPayloadFields(playerFields, 5)
      .map(decodeSnapshotFulu)
      .filter((tiles) => tiles.length);
  });

  return {
    round: chang !== undefined && ju !== undefined ? `${chang}-${ju}` : undefined,
    chang,
    ju,
    honba: numericField(fields, 3),
    currentTurn: numericField(fields, 4),
    leftTileCount: numericField(fields, 5),
    tiles: tileStringFields(fields, 6),
    doraIndicators,
    riichiSticks: numericField(fields, 8),
    scores: scores.some((score) => score !== undefined) ? scores.map((score) => score ?? 25000) : undefined,
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
    syncGameStep: sourceMethod === "ResSyncGame" ? numericField(carrier.fields, 3) : undefined,
    syncGameEnded: sourceMethod === "ResSyncGame" ? Boolean(numericField(carrier.fields, 2)) : undefined,
    enterGameEnded: sourceMethod === "ResEnterGame" ? Boolean(numericField(carrier.fields, 2)) : undefined,
    gameRestorePayloadLength: carrier.restoreEntry.bytes.length,
    gameRestorePayloadSample: bytesToHex(carrier.restoreEntry.bytes, BINARY_ENVELOPE_SAMPLE_BYTES),
    gameRestorePayloadTruncated: carrier.restoreEntry.bytes.length > BINARY_ENVELOPE_SAMPLE_BYTES
  }, carrier.restoreEntry.bytes);
}

function extractGameRestoreActionNames(payloadBytes) {
  if (!payloadBytes?.length) return [];
  const fields = parseProtobufEnvelope(payloadBytes).fields;
  return nestedPayloadEntries(fields, 2)
    .map((entry) => parseActionPrototype(entry.bytes)?.actionName)
    .filter(Boolean);
}

function extractRestoreActionNames(methodName, payloadBytes) {
  if (isGameRestoreMethod(methodName)) return extractGameRestoreActionNames(payloadBytes);
  if (isGameRestoreCarrierMethod(methodName)) {
    const carrier = getGameRestoreCarrierEntry(payloadBytes);
    return carrier?.restoreEntry ? extractGameRestoreActionNames(carrier.restoreEntry.bytes) : [];
  }
  return undefined;
}

function decodeSimpleActionPayload(actionName, bytes) {
  if (!actionName || !bytes?.length) return {};
  const decoded = parseProtobufEnvelope(bytes);
  const fields = decoded.fields;
  const allTiles = fields.lengthDelimited.map((entry) => entry.text).filter(tileLike);

  if (actionName === "ActionDiscardTile" || actionName === "RecordDiscardTile") {
    const decoded = {
      seat: numericField(fields, 1),
      tile: stringField(fields, 2),
      tsumogiri: Boolean(numericField(fields, 5)),
      isRiichi: Boolean(firstDefined(numericField(fields, 3), numericField(fields, 9))),
      doraIndicators: tileStringFields(fields, 8)
    };
    if (decoded.seat !== undefined || decoded.tile || decoded.doraIndicators.length) return decoded;
    return decodeUnityEncodedDiscardPayload(bytes) || decoded;
  }

  if (actionName === "ActionDealTile" || actionName === "RecordDealTile") {
    const riichi = decodeLiQiSuccess(fields, 5);
    return {
      seat: numericField(fields, 1),
      tile: stringField(fields, 2),
      leftTileCount: numericField(fields, 3),
      doraIndicators: tileStringFields(fields, 6),
      ...(riichi ? { riichi } : {})
    };
  }

  if (actionName === "ActionChiPengGang" || actionName === "RecordChiPengGang") {
    const riichi = decodeLiQiSuccess(fields, 5);
    return {
      seat: numericField(fields, 1),
      type: numericField(fields, 2),
      meld: tileStringFields(fields, 3),
      ...(riichi ? { riichi } : {})
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
      ...(scores.length ? { scores } : {}),
      ...(riichi ? { riichi } : {})
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
      round: chang !== undefined && ju !== undefined ? `${chang}-${ju}` : undefined,
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
      round: chang !== undefined && ju !== undefined ? `${chang}-${ju}` : undefined,
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

  const requestId = frameType === 1 ? null : bytes[1] | (bytes[2] << 8);
  const envelope = parseProtobufEnvelope(bytes.slice(messageOffset));
  const actionPrototype = envelope.methodName === ".lq.ActionPrototype" ? parseActionPrototype(envelope.payloadBytes) : null;
  const directActionName = actionPrototype ? null : actionNameFromMethod(envelope.methodName);
  const actionName = actionPrototype?.actionName || directActionName;
  const actionPayloadBytes = actionPrototype?.actionPayloadBytes
    || (directActionName ? envelope.payloadBytes : new Uint8Array());
  const actionPayloadFields = actionPrototype?.actionPayloadFields
    || (directActionName ? summarizePayloadFields(actionPayloadBytes) : undefined);
  const restoreActionNames = extractRestoreActionNames(envelope.methodName, envelope.payloadBytes);
  const publicEnvelope = {
    frameType,
    frameTypeName,
    requestId,
    methodName: envelope.methodName,
    actionName,
    restoreActionNames: restoreActionNames ? restoreActionNames.slice(0, 20) : undefined,
    step: actionPrototype?.step,
    payloadLength: envelope.payloadBytes.length,
    payloadSample: bytesToHex(envelope.payloadBytes, BINARY_ENVELOPE_SAMPLE_BYTES),
    payloadTruncated: envelope.payloadBytes.length > BINARY_ENVELOPE_SAMPLE_BYTES,
    actionPayloadLength: actionName ? actionPayloadBytes.length : undefined,
    actionPayloadSample: actionName ? bytesToHex(actionPayloadBytes, BINARY_ENVELOPE_SAMPLE_BYTES) : undefined,
    actionPayloadTruncated: actionName ? actionPayloadBytes.length > BINARY_ENVELOPE_SAMPLE_BYTES : undefined,
    actionPayloadFields
  };
  return {
    envelope: publicEnvelope,
    payloadBytes: envelope.payloadBytes,
    actionPayloadBytes
  };
}

export function parseBinaryEnvelope(data) {
  return parseBinaryFrame(data)?.envelope || null;
}

export function parseReadableMessage(data) {
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

export function parseDecodedMessage(data) {
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

export function parseBinaryMessage(data) {
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
  const actionPayload = actionName
    ? decodeSimpleActionPayload(actionName, frame.actionPayloadBytes)
    : {};
  return expandStandardEvents(type, {
    ...actionPayload,
    binaryEnvelope: envelope
  });
}

export { BINARY_ENVELOPE_SAMPLE_BYTES, toEventType, normalizePayload };
