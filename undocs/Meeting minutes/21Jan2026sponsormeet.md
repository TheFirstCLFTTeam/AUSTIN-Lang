# 21 Jan 2026 Meeting Minutes with Sponsor

**Follow Up:**

- Statistics on time taken for the business process of agent-client calls
  - Time taken for each call (average and variance)
  - How many calls a day
  - Average chance for a call to be referred to verification by risk team
- Statistics on time taken for business process of verification
  - Time taken for each verification (average and variance)
  - How many verifications a day
- Information about the masking program that UBS is using for personally identifiable data
- Information about cloud credits and other support UBS is offering
- Dictionary of commonly used terms

**Summary of Meeting**

Shaun to clarify that the customer-agent call is investment-related. Artur clarifies that it can be payment-related. E.g. in a banking relationship, the customer wants to transfer funds from one bank to another. There might also be other controls e.g. market, order.

These calls occur on a daily basis across different tasks. Some customers are quite active so they might host multiple trades/orders in a single call. Other customers may call only once a week. But every day there are calls.

Compliance needs to listen to the call and tick boxes that things are mentioned/discussed, to make sure that terms & conditions are explained to the client.

Larry confirms that there are 3 categories of users:

- User uploading the file (Artur not sure if this is automated - call may be automatically rerouted to UBS's system)
- Person who pulls out the tape and listens (verifier)
- Developers

Artur's understanding is that currently, called are sampled, and the compliance team guesses which calls may be higher risk (i.e. "if I want to find problems, I can more likely find them in this call")

Larry explaining the DB. Artur clarifies that there is 7 calendar days max retention period for recordings. Artur explains that devs have least access to data. Devs are typically green zone as opposed to the verifiers (red zone)

We will have access to a set of audio files where the transcription of financial terms is very bad. We will need to find a way to retrain the model without outsiders having access to the data.

Model has access to the edited transcripts too, which can be used to retrain the model.

The code we will need to write will need to run independently and train the model. Dev shouldn't see the data. Data is CID (Client identifying data) and is confidential.

Assume that our code is running in the red zone (where confidential data can be stored). But don't assume that developer has access to data in red zone.

Model is deployed in azure webapp. This resource is in red zone. Everything you put in azure has access to CID.

If there is a way of censoring all sensitive details (e.g. banking relationship number) from the call, the data is free of CID.

Need to maintain deletion logs

Gavin recalls that model weights could lead to the revealing of personal identification data. Artur clarifies that if there is no other way, we just need a process in place where almost nobody unauthorised can access. Our baseline is just to keep developers at least privilege. There has been literature on reversing datasets from the model weights.

Discussed about synthetic data that could be used to train our model. For compliance, there could be a way to strip conversations of the personally identifiable details. Potentially, there could be a way to change such details if detected, but there was a risk of collision where the changed transcript could be changed to become another person's transcript. Arthur mentions that the banking account data and terms used are usually standardised, suggesting that masking or alterations could be more straightforward.

Additionally, when the risk team uses the transcription program, there could be an algorithm to find missing terms in the report.

Arthur mentions that for transcription language errors, there were cases in Swiss German where mistranscriptions occur due to language token mix-up. This would be likened to how human learning different subjects may cause decay in certain information when focusing on one area

Shaun clarifies with Arthur that the verification occurs every day, with several tapes a day. Additionally, the verifier's role is specific, such as controls related to payments, which is very narrow. Meta data such as whether the call is made from internal or external, as well as phone numbers are stored. The system stores all the tapes and is related by ID, but not meta data

It is suggested that for our test solution, we could use the meta data file such as the corrections

Regarding the verification process, the risk team are users of the transcription process. Transcripts make it easier to fill up the form and identify important parts of the conversion. Currently, the risk team does not report on the error rate, only where a particular field is missing.

Additionally, there may be a risk of the transcript "jumping" or having incoherent switch of context.

Larry mentions the risk of model collapse where the model creates results of little variation.

Regarding the generation of audio files to feed the model, it was suggested that there could be a dictionary of financial term which is used by insiders of UBS in conversations. This could be domain specific terms, and could be used as a baseline.

A metric of success would be that the new transcription model could reduce the time taken, and then look at accuracy.