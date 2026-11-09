miniparquet.py is a ~150-line dependency-free Parquet reader (PLAIN/RLE/dictionary, SNAPPY/GZIP).
It exists because the authoring sandbox had no pyarrow and no network. build_data.py prefers pyarrow when installed.
