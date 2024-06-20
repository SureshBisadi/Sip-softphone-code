import React, { useEffect, useState } from "react";
import {
  Invitation,
  Inviter,
  InviterOptions,
  Referral,
  Registerer,
  RegistererOptions,
  Session,
  SessionState,
  UserAgent,
  UserAgentOptions,
  InvitationAcceptOptions
} from "sip.js";
import { Web } from "sip.js";

const User = () => {
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    const uri = UserAgent.makeURI("sip:6010@192.168.29.95");
    if (!uri) {
      throw new Error("Failed to create URI");
    }
    const transportOptions = {
      server: "wss://192.168.29.95:8089/ws"
    };
    const userAgentOptions: UserAgentOptions = {
      authorizationPassword: "6000",
      authorizationUsername: "6010",
      transportOptions,
      uri,
      noAnswerTimeout: 100
    };
    const userAgent = new UserAgent(userAgentOptions);

    // Function to handle incoming INVITE requests
    const handleIncomingCall = (invitation: Invitation) => {
      const incomingSession: Session = invitation;

      // Setup delegate for incoming session
      incomingSession.delegate = {
        onRefer(referral: Referral): void {
          // Handle incoming REFER request
        }
      };

      // Handle session state changes
      incomingSession.stateChange.addListener((newState: SessionState) => {
        switch (newState) {
          case SessionState.Establishing:
            console.log("Establishing Session");
            break;
          case SessionState.Established:
            console.log(" Session Established");
            break;
          case SessionState.Terminated:
            console.log(" Session Terminated");
            break;
          default:
            break;
        }
      });

      // Accept the incoming call
      const constraintsDefault: MediaStreamConstraints = {
        audio: true,
        video: false
      };

      const options: InvitationAcceptOptions = {
        sessionDescriptionHandlerOptions: {
          constraints: constraintsDefault
        }
      };

      invitation.accept(options);

      // Set the session
      setSession(incomingSession);
    };

    // Registerer to register user agent
    const registerer = new Registerer(userAgent);

    // Start the user agent
    userAgent.start().then(() => {
      registerer.register();

      // Handle incoming INVITE requests
      userAgent.delegate = {
        onInvite: handleIncomingCall
      };

      // Function to make outbound call
      const makeCall = () => {
        const target = UserAgent.makeURI("sip:6020@192.168.29.95");
        if (!target) {
          throw new Error("Failed to create target URI.");
        }

        const inviter = new Inviter(userAgent, target);

        const outgoingSession: Session = inviter;

        outgoingSession.delegate = {
          onRefer(referral: Referral): void {
            // Handle incoming REFER request
          }
        };

        outgoingSession.stateChange.addListener((newState: SessionState) => {
          switch (newState) {
            case SessionState.Establishing:
              // Session is establishing.
              break;
            case SessionState.Established:
              // Session has been established.
              break;
            case SessionState.Terminated:
              // Session has terminated.
              break;
            default:
              break;
          }
        });

        inviter
          .invite()
          .then(() => {
            // INVITE sent
          })
          .catch((error: Error) => {
            // INVITE did not send
          });

        // Set the session
        setSession(outgoingSession);
      };

      // Make a call
      makeCall();
    });

    // Cleanup function
    return () => {
      // Clean up any resources or listeners if necessary
    };
  }, []);

  useEffect(() => {
    if (session) {
      // Here you can use the session object
      const sessionDescriptionHandlerOptions: Web.SessionDescriptionHandlerOptions = {
        hold: true
      };
      session.sessionDescriptionHandlerOptionsReInvite = sessionDescriptionHandlerOptions;

      // Send re-INVITE
      session.invite().catch((error: Error) => {
        // Handle error if needed
      });
    }
  }, [session]);
};

export default User;
