"""Background worker that turns queued Supabase analysis requests into
prosody_coach analyses.

The web app never calls this directly. It inserts an ``analyses`` row
through the ``request_analysis`` RPC; this worker claims rows that are
still ``processing``, fetches the source audio, runs the analysis and
writes the result back:

    store.py      Supabase access (rows + storage), behind a small protocol
    sources.py    YouTube download and uploaded-WAV retrieval
    serialize.py  Recording -> phrase view model the Practice UI renders
    jobs.py       one row, end to end
    main.py       the polling loop
"""
