import protobufjs from 'protobufjs';

const schema = `
  syntax = "proto3";
  package remote;

  message RemoteImeObject {
    int32 start = 1;
    int32 end = 2;
    string value = 3;
  }

  message RemoteEditInfo {
    int32 insert = 1;
    RemoteImeObject text_field_status = 2;
  }

  message RemoteImeBatchEdit {
    int32 ime_counter = 1;
    int32 field_counter = 2;
    repeated RemoteEditInfo edit_info = 3;
  }

  message RemoteTextFieldStatus {
    int32 counter_field = 1;
    string value = 2;
    int32 start = 3;
    int32 end = 4;
    int32 int5 = 5;
    string label = 6;
  }

  message RemoteImeShowRequest {
    RemoteTextFieldStatus remote_text_field_status = 2;
  }

  message RemoteImeKeyInject {
    RemoteTextFieldStatus text_field_status = 2;
  }

  message RemoteMessage {
    RemoteImeKeyInject remote_ime_key_inject = 20;
    RemoteImeBatchEdit remote_ime_batch_edit = 21;
    RemoteImeShowRequest remote_ime_show_request = 22;
  }
`;

const root = protobufjs.parse(schema, { keepCase: false }).root;
const RemoteMessage = root.lookupType('remote.RemoteMessage');

export function createImeTextMessage(text, counters = {}) {
  const position = Math.max([...text].length - 1, 0);
  const message = RemoteMessage.create({
    remoteImeBatchEdit: {
      imeCounter: counters.imeCounter || 0,
      fieldCounter: counters.fieldCounter || 0,
      editInfo: [{
        insert: 0,
        textFieldStatus: {
          start: position,
          end: position,
          value: text,
        },
      }],
    },
  });
  return Buffer.from(RemoteMessage.encodeDelimited(message).finish());
}

function readDelimitedLength(buffer) {
  let length = 0;
  let shift = 0;
  for (let index = 0; index < Math.min(buffer.length, 5); index += 1) {
    const byte = buffer[index];
    length |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) return { headerLength: index + 1, length };
    shift += 7;
  }
  return null;
}

export function createImeStateDecoder(onState) {
  let pending = Buffer.alloc(0);

  return {
    push(data) {
      pending = Buffer.concat([pending, data]);

      while (pending.length) {
        const frame = readDelimitedLength(pending);
        if (!frame || pending.length < frame.headerLength + frame.length) return;

        const payload = pending.subarray(frame.headerLength, frame.headerLength + frame.length);
        pending = pending.subarray(frame.headerLength + frame.length);

        try {
          const message = RemoteMessage.decode(payload);
          const batch = message.remoteImeBatchEdit;
          const status = message.remoteImeShowRequest?.remoteTextFieldStatus
            || message.remoteImeKeyInject?.textFieldStatus;
          if (batch || status) {
            onState({
              ...(batch && {
                imeCounter: batch.imeCounter,
                fieldCounter: batch.fieldCounter,
                insertedText: batch.editInfo.map((edit) => edit.textFieldStatus?.value || '').join(''),
                insertMode: batch.editInfo[0]?.insert,
                insertionStart: batch.editInfo[0]?.textFieldStatus?.start,
                insertionEnd: batch.editInfo[0]?.textFieldStatus?.end,
              }),
              ...(status && {
                counterField: status.counterField,
                value: status.value,
                start: status.start,
                end: status.end,
              }),
            });
          }
        } catch {
          // Messages unrelated to IME use fields omitted from this minimal schema.
        }
      }
    },
  };
}
