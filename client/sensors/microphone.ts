import { ISensor } from "./isensor";
import { Sample } from "../models";

declare var webkitAudioContext: any;

declare class Recorder {
    constructor(mediaStream: MediaStreamAudioSourceNode, options: {
        numChannels: number;
    });

    record(): void;
    recording: boolean;
    stop(): void;
    exportWAV(fn: (blob: Blob) => any): void;
}

export class MicrophoneSensor implements ISensor {
    private _audioContext: AudioContext | undefined;
    private _constraints = {
        audio: true,
        video: false
    };
    private _stream: MediaStream | undefined;

    constructor() {
        if (this.hasSensor()) {
            this._audioContext = new (window.AudioContext || (<any>window).webkitAudioContext)();
        }
    }

    hasSensor() {
        return typeof window.AudioContext !== 'undefined' || typeof (<any>window).webkitAudioContext !== 'undefined';
    }

    checkPermissions(fromButton: boolean): Promise<boolean> {
        if (!this.hasSensor()) {
            throw new Error('Accelerometer not present on this device');
        }

        if (!fromButton) {
            return Promise.resolve(false);
        }

        return navigator.mediaDevices.getUserMedia(this._constraints).then(stream => {
            this._stream = stream;
            return Promise.resolve(true);
        });
    }

    getProperties() {
        return {
            name: 'Microphone',
            maxSampleLength: 1 * 60,
            frequencies: [ 16000 ]
        };
    }

    takeSample(length: number, frequency: number, processing: () => void) {
        return new Promise<Sample>((resolve, reject) => {
            if (!this._stream) {
                return reject('No audio stream');
            }

            if (frequency !== 16000) {
                return reject('Microphone only supports sampling at 16000Hz');
            }

            if (!this._audioContext) {
                return reject('No audio context');
            }

            // use the stream
            let input = this._audioContext.createMediaStreamSource(this._stream);

            // Create the Recorder object and configure to record mono sound (1 channel)
            // Recording 2 channels will double the file size
            let rec = new Recorder(input, {
                numChannels: 1
            });

            // start the recording process
            rec.record();

            setTimeout(() => {
                if (!this._stream) return;

                // tell the recorder to stop the recording
                rec.stop(); // stop microphone access
                this._stream.getAudioTracks()[0].stop();

                processing();

                // create the wav blob and pass it on to createDownloadLink
                rec.exportWAV(async (blob) => {
                    let buffer = await new Response(blob).arrayBuffer();
                    let wavFileItems = new Int16Array(buffer, 44);
                    let eiData = [];
                    for (let w of wavFileItems) {
                        eiData.push(w);
                    }

                    this._stream = undefined;

                    resolve({
                        values: eiData,
                        intervalMs: 1000 / 16000,
                        sensors: [{
                                name: "audio",
                                units: "wav"
                            }
                        ],
                    });
                });
            }, length);
        });
    };
}
