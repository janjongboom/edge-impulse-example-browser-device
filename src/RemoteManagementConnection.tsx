import React from "react";
import axios from "axios";
import {
  sampleRequestReceived,
  sampleFinished,
  sampleUploading,
  dataMessage,
  helloMessage,
  sampleRequestFailed,
  sampleStarted
} from "./messages";
import { parseMessage, createSignature, takeSample } from "./utils";
import { EdgeImpulseSettings, SampleDetails } from "./Models";
import { SampleRequestDetails } from "./SampleRequestDetails";
import { getRemoteManagementEndpoint, getIngestionApi } from "./settings";

interface RemoteManagementConnectionProps {
  settings: EdgeImpulseSettings;
}
interface RemoteManagementConnectionState {
  socketConnected: boolean;
  remoteManagementConnected: boolean;
  error: string | null;
  sample: SampleDetails | null;
  isSampling: boolean;
}
export class RemoteManagementConnection extends React.Component<
  RemoteManagementConnectionProps,
  RemoteManagementConnectionState
> {
  socket = new WebSocket(getRemoteManagementEndpoint());
  socketHeartbeat = -1;

  constructor(props: RemoteManagementConnectionProps) {
    super(props);
    this.state = {
      socketConnected: false,
      remoteManagementConnected: false,
      error: null,
      sample: null,
      isSampling: false
    };
  }

  componentDidMount() {
    this.socket.onopen = _e => {
      this.setState({
        socketConnected: true
      });
      this.sendMessage(helloMessage(this.props.settings));
      this.socketHeartbeat = window.setInterval(() => {
        this.socket.send("ping");
      }, 3000);
    };

    this.socket.onmessage = async event => {
      const data = await parseMessage(event);
      if (!data) {
        return;
      }

      if (data["hello"] !== undefined) {
        const msg = data["hello"];
        this.setState({
          remoteManagementConnected: msg.hello,
          error: msg.error
        });
      }

      if (data["sample"] !== undefined) {
        const msg = data["sample"] as SampleDetails;
        if (!msg || !msg.hmacKey) {
          this.sendMessage(sampleRequestFailed("Message or hmacKey empty"));
          return;
        }

        this.sendMessage(sampleRequestReceived);

        // Start to sample
        this.setState({
          sample: msg,
          isSampling: true
        });
        this.sendMessage(sampleStarted);
        const sampleDetails = { ...msg };
        const sampleData = await takeSample({
          length: msg.length
        });

        // Upload sample
        if (sampleData.measurements.length <= 0) {
          this.sendMessage(
            sampleRequestFailed("Was not able to capture any measurements")
          );
        } else {
          await this.uploadSample(
            sampleDetails,
            dataMessage(this.props.settings, sampleData.measurements)
          );
          this.setState({
            sample: msg,
            isSampling: false
          });
        }
      }
    };

    this.socket.onclose = event => {
      clearInterval(this.socketHeartbeat);
      const msg = event.wasClean
        ? `[close] Connection closed cleanly, code=${event.code} reason=${event.reason}`
        : // e.g. server process killed or network down
          // event.code is usually 1006 in this case
          "[close] Connection died";
      this.setState({
        socketConnected: false,
        remoteManagementConnected: false,
        error: msg
      });
    };

    this.socket.onerror = error => {
      this.setState({
        socketConnected: false,
        remoteManagementConnected: false,
        error: (error as unknown) as string
      });
    };
  }

  sendMessage = (data: any) => {
    this.socket.send(JSON.stringify(data));
  };

  uploadSample = async (
    details: SampleDetails,
    data: ReturnType<typeof dataMessage>
  ) => {
    try {
      // Sign it please
      data.signature = await createSignature(details.hmacKey, data);
      this.sendMessage(sampleUploading);
      await axios({
        url: getIngestionApi() + details.path,
        method: "POST",
        headers: {
          "x-api-key": this.props.settings.apiKey,
          "x-file-name": details.label,
          "Content-Type": "application/json"
        },
        data: data
      });
      this.sendMessage(sampleFinished);
    } catch (e) {
      alert(JSON.stringify(e));
    }
  };

  renderError(error: string) {
    return (
      <>
        <span className="error">{error}</span>
        <button
          onClick={() => {
            // TODO reconnect
          }}
        >
          Reconnect
        </button>
      </>
    );
  }

  render() {
    const { isSampling, sample, error } = this.state;
    if (error) {
      return this.renderError(error);
    }

    return (
      <>
        {<h3>Connected</h3>}
        {!isSampling && (
          <span>
            Start sampling from the 'Data Acquisition' tab in Edge Impulse
          </span>
        )}
        {isSampling && <span>Sampling in process</span>}
        {sample && (
          <SampleRequestDetails sampleDetails={sample}></SampleRequestDetails>
        )}
      </>
    );
  }
}
