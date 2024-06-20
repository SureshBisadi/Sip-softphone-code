import React, { useEffect, useRef, useState, useCallback } from "react";
import {
  Invitation,
  Inviter,
  Registerer,
  SIPExtension,
  Session,
  SessionState,
  UserAgent,
  UserAgentOptions,
  Web
} from "sip.js";
import { SessionDescriptionHandler } from "sip.js/lib/platform/web";
import axios from "axios";

const Agent = () => {
  const [incomingSession, setIncomingSession] = useState<Session | null>(null);
  const [outgoingSession, setOutgoingSession] = useState<Session | null>(null);
  const [isButtonDisabled, setIsButtonDisabled] = useState(true);
  const [isRegistered, setIsRegistered] = useState(false);
  const [isActive, setIsActive] = useState(false);
  const [isHold, setIsHold] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [status, setStatus] = useState("");

  const remoteMedia = useRef<HTMLAudioElement>(null);
  const localMedia = useRef<HTMLAudioElement>(null);
  const remoteAudioId = useRef<HTMLAudioElement>(null);
  const localAudioId = useRef<HTMLAudioElement>(null);

  const invitationRef = useRef<Invitation | null>(null);
  const outgoingSessionRef = useRef<Session | null>(null);
  const [Username, setUsername] = useState<string | undefined>(undefined);
  const userAgentRef = useRef<UserAgent | null>(null);
  const [localStream] = useState(new MediaStream());
  const [remoteStream] = useState(new MediaStream());
  const [step, setStep] = useState("initial");
  const [showOptions, setShowOptions] = useState(false);
  const [transferMode, setTransferMode] = useState(false);
  const [serverIp, setServerIp] = useState("");

  const playAudio = useCallback(() => {
    const session = outgoingSession || incomingSession;
    if (!session || session.state !== SessionState.Established || !session.sessionDescriptionHandler) return;

    const sessionDescriptionHandler = session.sessionDescriptionHandler as SessionDescriptionHandler;
    const peerConnection = sessionDescriptionHandler.peerConnection;

    if (peerConnection) {
      peerConnection.getReceivers().forEach((receiver) => {
        if (receiver.track) remoteStream.addTrack(receiver.track);
      });
      if (remoteMedia.current) {
        remoteMedia.current.srcObject = remoteStream;
        remoteMedia.current.play().catch((e) => console.error("Error playing remote media", e));
      }

      peerConnection.getSenders().forEach((sender) => {
        if (sender.track) localStream.addTrack(sender.track);
      });
      if (localMedia.current) {
        localMedia.current.srcObject = localStream;
        localMedia.current.play().catch((e) => console.error("Error playing local media", e));
      }
    }
  }, [incomingSession, outgoingSession, localStream, remoteStream]);

  const playConferenceAudio = useCallback(() => {
    if (incomingSession) incomingSession.invite({ sessionDescriptionHandlerModifiers: [] });

    const sessions = [
      incomingSession?.sessionDescriptionHandler,
      outgoingSession?.sessionDescriptionHandler
    ] as SessionDescriptionHandler[];
    if (!sessions) return;
    const context = new AudioContext();
    const allReceivedMediaStreams = new MediaStream();
    const receivedTracks: MediaStreamTrack[] = [];

    sessions.forEach((session) => {
      const peerConnection = session?.peerConnection;
      if (peerConnection) {
        peerConnection.getReceivers().forEach((receiver) => {
          receivedTracks.push(receiver.track);
        });
      }
    });
    sessions.forEach((session) => {
      const peerConnection = session?.peerConnection;
      if (peerConnection) {
        const mixedOutput = context.createMediaStreamDestination();
        peerConnection.getReceivers().forEach((receiver) => {
          receivedTracks.forEach((track) => {
            // allReceivedMediaStreams.addTrack(receiver.track);
            if (receiver.track && receiver.track.id !== track.id) {
              const sourceStream = context.createMediaStreamSource(new MediaStream([track]));
              sourceStream.connect(mixedOutput);
            }
          });
        });
        peerConnection.getSenders().forEach((sender) => {
          if (sender && sender.track) {
            const sourceStream = context.createMediaStreamSource(new MediaStream([sender.track]));
            sourceStream.connect(mixedOutput);
          }
        });
        peerConnection.getSenders()[0].replaceTrack(mixedOutput.stream.getTracks()[0]);
      }
    });

    [remoteAudioId.current, localAudioId.current].forEach((audio) => {
      if (audio) {
        (audio as HTMLMediaElement).srcObject = allReceivedMediaStreams;
        (audio as HTMLMediaElement).play().catch((error) => console.error("Error playing audio", error));
      }
    });
  }, [incomingSession, outgoingSession, remoteAudioId, localAudioId]);

  const handleCallResponse = useCallback(
    (accept: boolean) => {
      const invite = invitationRef.current;
      if (!invite) return console.error("No invitation available to process.");
      const options = { sessionDescriptionHandlerOptions: { constraints: { audio: true, video: false } } };
      const action = accept ? invite.accept(options) : invite.reject();
      action
        .then(() => {
          console.log(accept ? "Incoming INVITE Accepted" : "Incoming INVITE Rejected");
          playAudio();
        })
        .catch((error) => console.error(`Error ${accept ? "accepting" : "rejecting"} incoming call:`, error));
    },
    [playAudio]
  );

  const inviteWithSession = (session: Session, options: any) => {
    if (session?.state === SessionState.Established) session.invite(options);
  };

  const holdCall = useCallback(() => {
    const holdOptions = { sessionDescriptionHandlerModifiers: [Web.holdModifier] };
    if (outgoingSession) inviteWithSession(outgoingSession, holdOptions);
    else if (incomingSession) inviteWithSession(incomingSession, holdOptions);
    setIsHold(true);
  }, [outgoingSession, incomingSession]);

  const unholdCall = useCallback(() => {
    const unholdOptions = { sessionDescriptionHandlerModifiers: [] };
    if (outgoingSession) inviteWithSession(outgoingSession, unholdOptions);
    else if (incomingSession) inviteWithSession(incomingSession, unholdOptions);
    setIsHold(false);
  }, [outgoingSession, incomingSession]);

  const endSession = (session: Session) => {
    if (!session) return;
    switch (session.state) {
      case SessionState.Initial:
      case SessionState.Establishing:
        if (session instanceof Inviter) {
          session.cancel();
          session.dispose();
        }
        break;
      case SessionState.Established:
        session.bye();
        break;
      default:
        break;
    }
  };

  const endCall = useCallback(() => {
    if (outgoingSession) endSession(outgoingSession);
    if (incomingSession) endSession(incomingSession);
    [remoteAudioId.current, localAudioId.current].forEach((audio) => {
      if (audio) {
        (audio as HTMLMediaElement).srcObject = null;
        audio.pause();
      }
    });
    setIsActive(false);
    setShowOptions(false);
    setStep("initial");
  }, [outgoingSession, incomingSession]);

  const toggleMute = useCallback((isMuted: boolean, session: SessionDescriptionHandler) => {
    session.peerConnection?.getSenders().forEach((sender) => {
      if (sender.track) sender.track.enabled = !isMuted;
    });
  }, []);

  const handleSession = useCallback(
    (session: Session, isMuted: boolean) => {
      if (session?.state === SessionState.Established && session.sessionDescriptionHandler) {
        toggleMute(isMuted, session.sessionDescriptionHandler as SessionDescriptionHandler);
      }
    },
    [toggleMute]
  );
  const muteCall = useCallback(() => {
    if (outgoingSession) handleSession(outgoingSession, true);
    else if (incomingSession) handleSession(incomingSession, true);
    setIsMuted(true);
  }, [outgoingSession, incomingSession, handleSession]);

  const unmuteCall = useCallback(() => {
    if (outgoingSession) handleSession(outgoingSession, false);
    else if (incomingSession) handleSession(incomingSession, false);
    setIsMuted(false);
  }, [outgoingSession, incomingSession, handleSession]);

  const answerCall = useCallback(() => handleCallResponse(true), [handleCallResponse]);

  const rejectCall = useCallback(() => handleCallResponse(false), [handleCallResponse]);

  const handleMakeCallClick = () => {
    setShowOptions(true);
    setTransferMode(false);
  };

  const handleTransferClick = () => {
    setShowOptions(true);
    setTransferMode(true);
  };

  const handleInitialSelection = (event) => {
    const choice = event.target.value;
    const number =
      choice === "number" ? prompt(transferMode ? "Enter the transfer number:" : "Enter the phone number:") : null;
    if (number) {
      makeCall(`sip:${number}@${serverIp}`);
      setShowOptions(false);
    } else if (choice === "queue") {
      setStep("queue");
    }
  };

  const handleQueueSelection = (event: any) => {
    const queue = event.target.value;
    if (queue) {
      makeCall(`sip:${queue}@${serverIp}`);
      setStep("initial");
    }
  };

  const makeCall = useCallback(
    (targetURI: string) => {
      const target = UserAgent.makeURI(targetURI);
      if (!target) throw new Error("Failed to create target URI.");

      if (transferMode) {
        const session = outgoingSessionRef.current || invitationRef.current;
        if (session) {
          session.refer(target);
          session.dispose();
          if (outgoingSessionRef.current) setOutgoingSession(null);
          else if (invitationRef.current) setIncomingSession(null);
        }
      } else {
        const inviter = new Inviter(userAgentRef.current!, target);
        outgoingSessionRef.current = inviter;
        setOutgoingSession(inviter);
        inviter
          .invite()
          .then(() => {
            console.log("Invite Sent");
          })
          .catch((error) => {
            console.error("Error in Invite", error);
          });
      }
    },
    [transferMode, outgoingSessionRef, invitationRef]
  );

  const unregister = useCallback(() => {
    if (!userAgentRef.current) throw new Error("UserAgent not initialized");
    if (!isRegistered) return;
    const registerer = new Registerer(userAgentRef.current);
    registerer
      .unregister()
      .then(() => {
        setIsRegistered(false);
        console.log("UserAgent unregistered");
      })
      .catch((error) => {
        console.error("Error in unregistration process:", error);
      });
  }, [isRegistered]);

  const register = useCallback(() => {
    const userName = "1009";
    const password = "4321";
    const serverAddress = "10.16.7.11";

    setServerIp(serverAddress);
    const uri = UserAgent.makeURI(`sip:${userName}@${serverAddress}`);
    if (!uri) throw new Error("Failed to create URI");

    const transportOptions = {
      server: `wss://${serverAddress}:7443`,
      traceSip: true
    };
    const userAgentOptions: UserAgentOptions = {
      displayName: `${userName}`,
      authorizationPassword: `${password}`,
      authorizationUsername: `${userName}`,
      transportOptions,
      uri,
      // contactName: `${userName}`,
      // contactParams: { transport: "wss" },
      // viaHost: `${serverAddress}`,
      noAnswerTimeout: 60,
      instanceIdAlwaysAdded: true,
      forceRport: true
    };
    const userAgent = new UserAgent(userAgentOptions);
    userAgentRef.current = userAgent;

    const registerer = new Registerer(userAgent);

    userAgent
      .start()
      .then(() => {
        console.log("userAgent Started");
        return registerer.register();
      })
      .then(() => {
        setIsRegistered(true);
        console.log("UserAgent registered");
      })
      .catch((error) => {
        console.error("Error in registration process:", error);
      });
  }, []);

  useEffect(() => {
    const handleSessionStateChange = (session: Inviter | Invitation, newState: SessionState, isOutgoing: boolean) => {
      switch (newState) {
        case SessionState.Establishing:
          console.log(`${isOutgoing ? "Outgoing" : "Incoming"} Call Establishing`);
          if (isOutgoing && incomingSession) {
            incomingSession.invite({ sessionDescriptionHandlerModifiers: [Web.holdModifier] });
          }
          break;
        case SessionState.Established:
          console.log(`${isOutgoing ? "Outgoing" : "Incoming"} Call Established`);
          setIsActive(true);
          if (isOutgoing) {
            setOutgoingSession(session as Inviter);
            playAudio();
          } else {
            setIncomingSession(session as Invitation);
          }
          break;
        case SessionState.Terminated:
          console.log(`${isOutgoing ? "Outgoing" : "Incoming"} Call Terminated`);
          if (isOutgoing) {
            setOutgoingSession(null);
          } else {
            setIncomingSession(null);
            setIsButtonDisabled(true);
          }
          setIsActive(false);
          setShowOptions(false);
          setStep("initial");
          break;
        default:
          break;
      }
    };

    const handleInvite = (invitation: Invitation) => {
      setIsButtonDisabled(false);
      setIncomingSession(invitation);
      invitationRef.current = invitation;
      setUsername(invitation.remoteIdentity.displayName || undefined);

      const handleStateChange = (newState: SessionState) => handleSessionStateChange(invitation, newState, false);
      invitation.stateChange.addListener(handleStateChange);

      return () => {
        invitation.stateChange.removeListener(handleStateChange);
      };
    };

    if (userAgentRef.current) {
      userAgentRef.current.delegate = { onInvite: handleInvite };
    }

    if (outgoingSession) {
      const handleOutgoingStateChange = (newState: SessionState) =>
        handleSessionStateChange(outgoingSession as Inviter, newState, true);
      outgoingSession.stateChange.addListener(handleOutgoingStateChange);

      return () => {
        outgoingSession.stateChange.removeListener(handleOutgoingStateChange);
      };
    }
    return () => {
      if (invitationRef.current) {
        const handleStateChange = (newState: SessionState) =>
          handleSessionStateChange(invitationRef.current as Invitation, newState, false);
        invitationRef.current.stateChange.removeListener(handleStateChange);
      }
    };
  }, [
    userAgentRef,
    outgoingSession,
    incomingSession,
    playAudio,
    setIsActive,
    setOutgoingSession,
    setIncomingSession,
    setIsButtonDisabled,
    setUsername
  ]);

  function handleStatusChange(event: any) {
    const selectedStatus = event.target.value;
    setStatus(selectedStatus);
    if (selectedStatus === "Logged Out") unregister();
    axios
      .post("http://localhost:3000/Set-Agent-Status", { agent: "1014", status: selectedStatus })
      .then((response) => {
        console.log("Agent status:", response.data);
      })
      .catch((error) => {
        console.error("Error setting agent status:", error);
      });
  }

  useEffect(() => {
    return () => {
      endSession(outgoingSessionRef.current!);
      if (userAgentRef.current) userAgentRef.current.stop();
    };
  }, []);

  return (
    <div>
      <button onClick={register} disabled={isRegistered}>
        Register
      </button>
      <button onClick={unregister} disabled={!isRegistered}>
        UnRegister
      </button>
      <button onClick={handleMakeCallClick} disabled={!isRegistered}>
        Make Call
      </button>
      <button onClick={handleTransferClick} disabled={!isActive}>
        Transfer Call
      </button>
      {showOptions && (
        <div>
          <button value="number" onClick={handleInitialSelection}>
            {transferMode ? "Transfer to Number" : "Call Number"}
          </button>
          <button value="queue" onClick={handleInitialSelection}>
            {transferMode ? "Transfer to Queue" : "Call Queue"}
          </button>
        </div>
      )}
      {step === "queue" && (
        <div>
          <select onChange={handleQueueSelection} defaultValue="">
            <option value="" disabled>
              Select a Queue
            </option>
            <option value="sales">sales</option>
            <option value="billing">billing</option>
            <option value="support">support</option>
            <option value="development">development</option>
          </select>
        </div>
      )}
      <button onClick={answerCall} disabled={isButtonDisabled}>
        Answer call
      </button>
      <button onClick={rejectCall} disabled={isButtonDisabled}>
        Reject Call
      </button>
      <button onClick={isHold ? unholdCall : holdCall} disabled={!isActive}>
        {isHold ? "Unhold" : "Hold"}
      </button>
      <button onClick={isMuted ? unmuteCall : muteCall} disabled={!isActive}>
        {isMuted ? "Unmute" : "Mute"}
      </button>
      <button onClick={endCall} disabled={!isActive}>
        End
      </button>
      <button onClick={playConferenceAudio} disabled={!isActive}>
        Start Conference
      </button>
      <audio ref={remoteMedia} />
      <audio ref={localMedia} muted />

      <audio ref={remoteAudioId} />
      <audio ref={localAudioId} muted />

      <label htmlFor="status-dropdown">Choose a status:</label>
      <select id="status-dropdown" value={status} onChange={handleStatusChange} disabled={!isRegistered}>
        <option style={{ display: "none" }} value=""></option>
        <option value="Logged Out">Logged Out</option>
        <option value="Available">Available</option>
        <option value="Available (On Demand)">Available (On Demand)</option>
        <option value="On Break">On Break</option>
      </select>

      {!isButtonDisabled && <h4>Incoming call from {Username}</h4>}
    </div>
  );
};

export default Agent;
