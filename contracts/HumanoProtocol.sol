// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract HumanoProtocol {
    struct PhotoUpload {
        uint256 id;
        bytes32 uploaderKey;
        string pieceCid;
        string worldAction;
        string verificationLevel;
        uint256 capturedAt;
        uint256 recordedAt;
        uint256 size;
        string retrievalUrl;
        address recorder;
    }

    string public constant PROTOCOL_NAME = "humano_protocol";

    uint256 public totalUploads;

    mapping(uint256 => PhotoUpload) private uploads;
    mapping(bytes32 => uint256[]) private uploaderUploadIds;
    mapping(bytes32 => uint256) public uploadIdByPieceCidHash;

    event PhotoUploadRecorded(
        uint256 indexed uploadId,
        bytes32 indexed uploaderKey,
        string pieceCid,
        string verificationLevel,
        string worldAction,
        address indexed recorder
    );

    error EmptyUploaderKey();
    error EmptyPieceCid();
    error DuplicatePieceCid();

    function recordPhotoUpload(
        bytes32 uploaderKey,
        string calldata pieceCid,
        string calldata worldAction,
        string calldata verificationLevel,
        uint256 capturedAt,
        uint256 size,
        string calldata retrievalUrl
    ) external returns (uint256 uploadId) {
        if (uploaderKey == bytes32(0)) revert EmptyUploaderKey();
        if (bytes(pieceCid).length == 0) revert EmptyPieceCid();

        bytes32 pieceCidHash = keccak256(bytes(pieceCid));
        if (uploadIdByPieceCidHash[pieceCidHash] != 0) revert DuplicatePieceCid();

        uploadId = ++totalUploads;

        uploads[uploadId] = PhotoUpload({
            id: uploadId,
            uploaderKey: uploaderKey,
            pieceCid: pieceCid,
            worldAction: worldAction,
            verificationLevel: verificationLevel,
            capturedAt: capturedAt,
            recordedAt: block.timestamp,
            size: size,
            retrievalUrl: retrievalUrl,
            recorder: msg.sender
        });

        uploaderUploadIds[uploaderKey].push(uploadId);
        uploadIdByPieceCidHash[pieceCidHash] = uploadId;

        emit PhotoUploadRecorded(
            uploadId,
            uploaderKey,
            pieceCid,
            verificationLevel,
            worldAction,
            msg.sender
        );
    }

    function getPhotoUpload(uint256 uploadId) external view returns (PhotoUpload memory) {
        return uploads[uploadId];
    }

    function getUploaderUploadIds(bytes32 uploaderKey) external view returns (uint256[] memory) {
        return uploaderUploadIds[uploaderKey];
    }

    function getUploaderUploadCount(bytes32 uploaderKey) external view returns (uint256) {
        return uploaderUploadIds[uploaderKey].length;
    }
}

