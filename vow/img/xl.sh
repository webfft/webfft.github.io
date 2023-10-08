#!/bin/bash

for f in *.png; do
  ffmpeg -i $f xl_${f%.*}.jpg
  ffmpeg -i $f -vf scale=256:-1 ${f%.*}.jpg
done
